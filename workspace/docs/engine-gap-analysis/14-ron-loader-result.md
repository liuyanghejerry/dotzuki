# 14 — No-code RON Loader: Result + Dual-mode Verdict

**Status: GO.** An independent audit of Phase 2 (commit `7b3814ac`) confirms the
no-code RON loader delivers its promise: a developer authors moves / abilities /
types / statuses / items in `rules.ron` with **zero Rust**; the same file is
**hot-reloaded in dev** and **baked in release**; the data path is
**deterministic** and replays a ruleset identically under a `ScriptedRng`; and
the engine stays **100% game-agnostic** (zero engine files touched in P2).

This document records what shipped, the dual-mode mechanism, the parity +
**mutation** evidence, which battle systems are now data vs still native, and the
honest limits + the next vocabulary additions needed.

---

## 1. What shipped

Two phases on `feature/p0-engine-migration` build the loader:

| commit | what |
|---|---|
| `50907df0` | engine fires `Event::Effectiveness` in the stack driver (inert no-op with no subscriber); the `Event::Effectiveness` *seam* itself predates this — it was a subscription seam already in the P0 effect-stack (`event.rs`, commit `4f3b5ff2`). |
| `cc6a6147` (P1) | `jrpg-rules` crate: RON loader + closed primitive interpreter bridge. |
| `7b3814ac` (P2) | dual-mode (`hot-reload` dev / baked release) `RuleSource`; minimon `rules.ron` 金木水火土 parity + mutation/reload tests. **Touches zero `crates/jrpg-engine` files.** |

New game-side crate `crates/jrpg-rules` (deps = `jrpg-engine`, `serde`, `ron`,
`thiserror`, and `notify` *optional* behind `hot-reload`). It pulls in **no**
pokered / minimon code and references **no** concrete game type — it is a
consumer of the engine's closed primitive vocabulary, and it amortizes content;
it does not extend mechanics.

The example consumer is `examples/minimon/rules.ron` (114 lines of pure data:
`stats`, `types`, a `type_chart`, and `effects` with `Hook(on: …, do: […])`
op-lists), loaded by `examples/minimon/src/data.rs`.

---

## 2. The dual-mode mechanism (one rules.ron, two access modes)

`jrpg_rules::RuleSource` (`crates/jrpg-rules/src/source.rs`) yields the **same**
`Ruleset` two ways through one `Ruleset::from_ron`:

* **Baked (RELEASE, default)** — `RuleSource::baked(include_str!("../rules.ron"))`.
  Compiled into the binary; **zero file IO**. The only `std::fs::read_to_string`
  in the crate (`source.rs:127`) is reachable *only* from the `RuleSource::Disk`
  match arm (`source.rs:85`); the `Baked` arm (`source.rs:83`) parses the
  `&'static str` directly. The `notify` watcher is entirely behind
  `#[cfg(feature = "hot-reload")]`.
* **Disk (DEV)** — `RuleSource::from_path(p)` reads `rules.ron` at load and,
  behind the `hot-reload` feature, watches it. `poll_changed()` drains a `notify`
  watcher (parent-dir watch, replace-on-save tolerant) and signals an edit so the
  game re-`load()`s + `install_compiled()` (swaps the registry) **between turns**.

Feature gating: `jrpg-rules` `default = []` (= baked, no `notify`),
`hot-reload = ["dep:notify"]`. minimon mirrors it: `default = []`,
`hot-reload = ["jrpg-rules/hot-reload"]`. `RULES_RON_BAKED =
include_str!("../rules.ron")` and `RULES_RON_PATH = env!CARGO_MANIFEST_DIR +
"/rules.ron"` point at the **same** file.

**Builds verified both ways (forced, exit 0):** `cargo build --workspace`
(baked default), `cargo build -p jrpg-rules --features hot-reload`,
`cargo build -p minimon --features hot-reload`.

**Dual-mode equality test (`baked_and_disk_yield_identical_ruleset`):** loads the
baked text and the on-disk file, compiles both, and asserts identical effect
count, chart-edge count, compiled-hook count, interned types, interned stats,
interned status vocabulary, and **byte-identical compiled hooks** (sorted by
`EffectId`). `baked_and_disk_drive_identical_battle` then runs the same battle on
both and asserts identical damage (the resisted 40). Both pass.

---

## 3. Parity evidence + mutation results

The native minimon effects (`lib.rs`, the oracle with a hand-authored chart) and
the data-loaded effects (`DataBattle`, reading the **compiled RON** chart via
`CompiledRuleset::chart_mult`) drive the same scenarios and must agree.

**Parity (baseline, all green):** the headline 金木水火土 chart —
`160 / 40 / 0 / 80` (super-effective / resisted / immune / neutral) — asserted on
**both** paths (`chart_super_effective_160_parity`, `chart_resisted_40_parity`,
`chart_immune_0_parity`, `chart_neutral_80_parity`,
`chart_full_160_40_0_80_ordering_parity`). Plus split (Physical 80 / Special 40),
chip-before-heal must-pass `94`, Sandstorm `(94, 100, 150, 100)`, Intimidate `-1`
and Clear-Body-veto `0`. Every assertion checks identical `BattleState` AND
identical `ScriptedRng` draw counts.

**Mutation test (proves the RON drives outcomes, not a hardcoded shadow).** The
auditor edited `rules.ron`'s 金克木 edge `[2, 1] → [1, 1]` and re-ran the
super-effective parity test. It **FAILED at the native-vs-data assertion**:

```
assertion `left == right` failed: native vs data damage parity for move.blade vs Wood
  left: 160      (native oracle, hardcoded chart — unchanged)
 right: 80       (data path — read the mutated RON: 80*1/1 = 80)
```

Restoring `rules.ron` returned all chart parity tests to green, and the file is
byte-identical to the committed version. This conclusively proves the data path
is driven by `rules.ron` — the `chart_mult` `HashMap` lookup is the live source
of the multiplier, not a Rust constant shadowing the same numbers.

A second mutation lives **in-tree** (`reload_changes_outcome`): swapping the
registry to a mutated ruleset turns `160 → 80`, and restoring it returns `80 →
160` — the swap is real and reversible.

---

## 4. Reload safety (doc 11 §4.2)

A mid-battle registry swap is safe because the swap replaces only the
**vocabulary** (`CompiledRuleset`: the `EffectId`→op-list map + interned
chart/types/stats), while **live per-effect state lives in the engine's
`EffectState` arena**, keyed by `EffectId`, never in the data. `install_compiled`
points a thread-local `&'static RulesHost` at a fresh leaked host; in-flight
state is untouched.

Tests: `reload_changes_outcome` (in-memory edit + recompile + install ⇒ changed
then restored outcome) and the feature-gated
`hot_reload_watcher_reloads_changed_file` (writes/edits a real temp file, polls
the `notify` watcher, reloads) — both pass.

---

## 5. Determinism

Structural, not incidental. The interpreter (`crates/jrpg-rules/src/interp.rs`)
has **one** source of entropy: `ctx.rng.chance(num, den)` (a `BattleRng` trait
object). The chance gate is drawn **unconditionally** per hook, so the draw count
and order are a pure function of the op-list, independent of any branch outcome —
which is exactly what lets a `ScriptedRng` replay a data ruleset identically to a
native run. There is **no** clock / `Instant` / `SystemTime` / `thread_rng` /
`rand::` in the crate's non-test code, and **no** `HashMap` iteration in the fold
path (the chart is a point `HashMap::get`; multi-source ordering is the engine's
`run_event` sort by `order` field with an `EffectId` tiebreak). The chart path
consumes **zero** RNG draws on both baked and disk registries
(`data_chart_consumes_zero_draws_both_modes`).

---

## 6. Data vs still-native (honest split)

| system | where it lives now | note |
|---|---|---|
| 金木水火土 type chart + per-element typed moves | **DATA** (`type_chart` + `ApplyTypeChart`) | reads compiled RON `chart_mult`; mutation-proven |
| poison residual chip (1/8, order 10) | **DATA** (`DamageFraction`) | cross-source ordering via `source_effect` keys |
| Leftovers (1/16 heal, order 20, after chip) | **DATA** (`HealFraction`) | the must-pass chip-before-heal `94` |
| Sandstorm chip (1/16 non-Rock) + Rock SpD ×1.5 | **DATA** (`DamageFraction` / `ScaleRelay` + `StatIs`) | |
| Intimidate (−1 Atk request) + Clear Body (veto) | **DATA leaf ops** (`Boost` / `VetoIf`) | the *leaf* ops are data; the cascade is native (below) |
| phys/special **split** (category/power → which stat) | **provider + data** | invisible to the engine by design (doc 11 §1); never an effect |
| Intimidate ↔ Clear-Body **nested-veto cascade** | **native driver orchestration** | the veto-then-apply *shape* is identical Rust for both paths; only the leaf ops come from data |

---

## 7. Honest limits + next vocabulary additions

1. **Self-orchestrating vetoable boost.** `Boost` applies directly; it cannot
   self-orchestrate a nested vetoable `TryBoost` dispatch. The Intimidate↔Clear-Body
   cascade therefore stays driver orchestration. *Next:* a primitive that issues a
   vetoable boost request (fires `TryBoost`, then applies iff not vetoed).
2. **Folded-stat threading.** `StatIs("SpD")` reads the in-flight stat index from
   the driver's per-action scratch (`mv.last_damage` as a `current_stat_index`
   sentinel) because the engine does not thread the folded stat into the relay.
   Works here because the driver fires `WeatherModifyStat` only for SpD. *Next:* a
   typed stat lane on the relay so `StatIs` reads it directly.
3. **Per-effect counter state** (Counter / Bide / Substitute) is unreachable from
   data: `P::EffectStateKind` is compile-time. *Next:* a data-declarable
   counter/integer state slot in `EffectState`.
4. **Dual-typing product fold** is supported by `chart_mult` + the binding fold but
   exercised at one type/battler (minimon battlers are mono-type). *Next:* a
   multi-type fixture to exercise the slice product end to end.

None of these block the proof; all are pre-flagged escape-hatch / Phase-3 work.
The data layer is a consumer of the closed vocabulary (doc 11 §5): it amortizes
content, it does not extend mechanics — extending mechanics is an additive engine
seam, of which P2 added **zero**.

---

## 8. Verdict — GO

The audit reproduced every load-bearing claim from `ACTUAL` committed code:

* **Dual-mode real** — one `rules.ron` → baked (`include_str!`, zero IO) and disk,
  one `Ruleset::from_ron`, feature-gated; baked-equals-disk test passes; both
  builds exit 0.
* **Parity + mutation** — `160/40/0/80` green; editing the RON `[2,1]→[1,1]` made
  the parity test fail (data 80 vs native 160), restore returns green.
* **Reload safe** — registry swap changes outcome and is reversible; live state in
  the engine arena, not the data.
* **Deterministic** — sole entropy `ctx.rng`, drawn unconditionally; zero draws on
  the chart path on both modes; no clock / no draw-order `HashMap` iteration.
* **Engine-agnostic + green + disciplined** — `jrpg-engine` untouched in P2 (no
  `rand`, no game types); `jrpg-rules` deps = `jrpg-engine` only (+ serde/ron/
  thiserror, optional notify); `cargo build --workspace` exit 0; jrpg-engine
  **318/0**, jrpg-rules **24/0** (both modes), minimon **31/0** default / **32/0**
  hot-reload, pokered-core **1907/0**; the **88** stack-parity tests green parallel
  3× AND single-thread (identical); tree clean (excl png/lock); exactly one commit
  since P1, trailer present.

A developer can author battle content in `rules.ron` with no Rust, iterate live
in dev via hot-reload, ship it baked in release, and trust it to be deterministic
and engine-agnostic. **GO.**
