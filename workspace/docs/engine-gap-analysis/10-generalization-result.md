# Battle-Engine Generalization Result — GO / NO-GO [P0b]

**Verdict: GO-WITH-NITS — the engine generalizes.** A developer can author Gen-1-to-Gen-6-LIKE
battle systems (physical/special split, abilities + an ability veto, held-item residual ordering,
field-hosted weather with stat-fold layering) entirely on `dotzuki-engine`'s effect-stack **with zero
engine edits** beyond the Phase-1 additive/defaulted seams. The single nit is a *documentation*
correction to the design's §4.2b sketch (re-entrant dispatch is a driver pattern, not a handler
pattern); it is borrow-correct and additive, not a kill signal.

Branch `feature/p0-engine-migration`. Independently audited at HEAD `eaedca05` (Phase 2 minimon
commit, built on Phase-1 engine commit `4f3b5ff2`). This is the answer to design
[`09-battle-engine-generalization-design.md`](09-battle-engine-generalization-design.md) §6.2.

---

## The §6.2 Go/No-Go table — filled, with evidence

| Axis | Verdict | Evidence |
|---|---|---|
| **Authoring** | **GO** | All 5 systems (split, Intimidate, Clear Body veto, Leftovers, Sandstorm) are authored in `examples/minimon` as `const`/`static Effect`s of **zero-capture `fn`s** via the §4 `effect!` macro / `EventHook`. `git show --stat HEAD` touches **only** `examples/minimon/{Cargo.toml,src/lib.rs,src/tests.rs}` + workspace `Cargo.toml`/`Cargo.lock` — **no `crates/dotzuki-engine` file**. `git diff --quiet HEAD~1 -- crates/dotzuki-engine` ⇒ engine **byte-identical**. No new non-defaulted engine method; no `if gen==N` / `if ability==` in the engine. |
| **Agnosticism** | **GO** | `examples/minimon/Cargo.toml` `[dependencies]` = `dotzuki-engine` **only**. `cargo tree -p minimon` ⇒ `minimon → dotzuki-engine` (plus dotzuki-engine's own `image`/`serde`/`thiserror`); **no pokered/pokered-core/pokered-data, no `rand`**. The only `pokered`/`rand`/`RefCell`/`Rc`/`unsafe` strings in `examples/minimon/src` are **doc comments**. Engine still links no `rand` (absent from `crates/dotzuki-engine/Cargo.toml`) and names **no `minimon`/Pokémon concrete type** in non-test code. |
| **Non-breaking** | **GO** | The 88 stack-parity slices stay green **unchanged**: `88 passed / 0 failed` in 3× parallel runs AND `--test-threads=1`, identical. `dotzuki-engine` `311 passed / 0 failed` (+3 doctests) and `pokered-core` `1907 passed / 0 failed` — both unchanged (the existing game compiled against an untouched engine, proving every Phase-1 resolver/event/`EffectHost` seam is additive+defaulted). `cargo build --workspace` exit 0. |
| **Borrow** | **GO** | minimon handlers all take `&mut BattleCtx`, never a borrowed battler/effect ref, never `&P`. Multi-source collection uses the collect-then-fold owned snapshot (`collect_handlers` → `run_event`/`run_event_checked`) + per-step liveness re-check. **No new `RefCell`/`Rc`/`unsafe`** in either phase; the battle stack still has exactly **one** `unsafe` block (`ctx.rs:345`, the cross-side `pair_mut`), **unchanged** across both phases (`git diff 4f3b5ff2~1 HEAD` shows no `+/-` line touching it). |
| **Generality** | **GO** | All 9 hand-derived outcome tests hold (no parity oracle): split 80(phys) vs 40(special); Intimidate drops foe Atk −1 → its move deals 52 (< 80); Clear Body keeps Atk 0 → full 80; both abilities collected on **one** `TryBoost` in comparator order (`orders == [5]`, target = foe — cross-battler collection); Leftovers nets 94 (chip 12 then heal 6) vs 88 chip-only (proves cross-source `order`); Sandstorm chips Normal→94 / Rock immune at 100, Rock SpD ×1.5 100→150 (ModifyStat→WeatherModifyStat layering); weather-off control no-op; field-hosted witness (`EffectHost::Field`). **Mutation-check below** proves these assert real behavior. |

**Overall: GO-WITH-NITS.** Authoring and Borrow — the two kill-signal axes — are both GO. The one
nit is a documentation correction, not a re-open of the design.

---

## Mutation-check (proves the tests are not tautologies)

Per §6.2 Generality, the audit broke one authored interaction and confirmed a minimon test fails,
then restored it:

- **Mutation:** `clear_body_try_boost` changed to never veto (`HandlerResult::Unchanged` on a
  negative delta instead of `HandlerResult::Fail`).
- **Result:** `tests::clear_body_cancels_intimidate` **FAILED** —
  `assertion left == right failed` at `tests.rs:110` (`left = -1`, expected `0`: the un-vetoed
  Intimidate drop reached the foe's Atk stage). `8 passed; 1 failed`.
- **Restore:** veto re-enabled ⇒ `9 passed / 0 failed`; `lib.rs` byte-identical to HEAD.

The veto is load-bearing: the test asserts the real Clear Body behavior, not a constant.

---

## Literal test totals (this audit, against committed `eaedca05`)

- `cargo build --workspace` → **exit 0**
- `cargo test -p minimon` → **9 passed / 0 failed** (+ 0 doctests)
- `cargo test -p dotzuki-engine` → **311 passed / 0 failed** (+ 3 doctests; 7 pre-existing `ignored`)
- `cargo test -p pokered-core` → **1907 passed / 0 failed**
- `cargo test -p pokered-core --lib stack` → **88 passed / 0 failed**, identical across 3× parallel
  AND `--test-threads=1`

Note on baselines: the hard-constraint floor cites `dotzuki-engine 303`; that is the *pre-P0b*
baseline. Phase 1 (engine commit `4f3b5ff2`, audited all-PASS) added 8 engine tests additively
(303 → 311); Phase 2 left the engine **byte-identical** at 311. No regression — the floor rose by
additive Phase-1 tests, not by edits in Phase 2.

---

## The minimon authoring walkthrough — the developer reference

`examples/minimon/src/lib.rs` (847 lines) is the canonical "how a developer authors a cross-gen
system on this engine" reference. The shape to copy:

1. **Data model** — define your own `P::Stat` (here the 6-stat Gen-4 `{Hp,Atk,Def,SpA,SpD,Spe}`
   shape), `Type`, `Status`, `Ability`, `Item`, `Species`, `Move`. All opaque to the engine.
2. **`BattleProvider::calculate_damage`** — the physical/special split lives **entirely here**
   (pick `Atk/Def` vs `SpA/SpD` by `move.category`). The engine never sees the category — **no
   engine change for the split** (design §5).
3. **`EffectProvider` resolvers** — map opaque ids to `&'static Effect`:
   `effect_for_ability` (Intimidate/Clear Body), `effect_for_item` (Leftovers),
   `effect_for_status` (poison chip), `field_effects` (Sandstorm, hosted on `EffectHost::Field`).
   All are **defaulted** on the trait, so existing games are unaffected.
4. **Authored effects** — each is a `const`/`static Effect` of zero-capture `fn(&mut BattleCtx, …)`
   handlers, built with the `effect!` macro. Abilities are just Effects; items are just Effects;
   weather is just a field-hosted Effect. No `if gen`/`if ability` anywhere.
5. **Driver helpers** (`Battle::switch_in` / `try_boost` / `fire_move` / `end_of_turn_residual` /
   `weather_residual` / `effective_spd_with_weather`) — the **game** owns dispatch. They hold `&P`,
   build owned handler snapshots via `collect_handlers`, and fold via `run_event` /
   `run_event_checked`. This is the §2.3 collect-then-fold borrow discipline, mirrored from the
   engine's own `StackDriver`.

`examples/minimon/src/tests.rs` (273 lines) is the matching reference for **how to assert
cross-gen outcomes without a parity oracle** — hand-derived expected `BattleState` results plus
controls (poison-alone, weather-off) that pin each number to one cause.

---

## What's proven vs what's still follow-up

**Proven by this result:**
- The broadened taxonomy (31 event kinds + `Custom`), the 4 defaulted resolvers, `EffectHost::Field`,
  and the `order` comparator tier are **sufficient** to author the five representative cross-gen
  systems with **no engine edit**.
- The collect-then-fold + liveness-re-check model handles **cross-battler** collection (two abilities
  on one `TryBoost`, hosted on different battlers) and **cross-source** residual ordering
  (status chip before item heal) without interior mutability.
- Every seam is additive+defaulted: the existing Gen-1 game and its 88 parity slices are green,
  unchanged — generality did **not** cost fidelity.

**The one nit (GO-WITH-NITS, documentation only):**
- The handler signature `HandlerFn` gives `&mut BattleCtx` but **not `&P`**, so a handler **cannot
  re-enter dispatch** (re-entry needs `&P` to run resolvers). Intimidate's "SwitchIn fires a
  vetoable TryBoost" is therefore expressed as: the handler records intent, and the **game's driver
  helper** (which holds `&P`) fires the TryBoost. This is borrow-correct and mirrors the engine's
  own `StackDriver` re-entry, so it is **not a NO-GO**. But it means design §09 §4.2b's
  `try_boost(ctx, …)`-from-inside-a-handler sketch is optimistic: cross-effect "an ability triggers
  another event" is a **driver-orchestration** pattern, not a handler pattern. A future *optional*
  ergonomic would be a defaulted `BattleCtx::fire_subevent` shim carrying the provider; not required
  for generality.

**Still follow-up (explicitly out of §6.1 scope — NOT regressions):**
- **Doubles / multi-target** — the `redirect_target` seam exists (defaulted, inert) but is unproven;
  minimon is 1v1.
- **Full move tables / multi-hit / accuracy / crit** — minimon authors 2 moves with a deliberately
  tiny deterministic `power*atk/def` formula (no rolls) so outcomes are hand-checkable.
- **AI, switching policy, real RNG-driven secondary effects** — not exercised.
- **Wiring to pokered's production loop** — unchanged and out of scope; this proves *generality of
  the authoring surface*, not a production swap. Gen-1 fidelity remains a regression credential
  only (the 88 slices), per [`08-effect-stack-migration-status.md`](08-effect-stack-migration-status.md).

---

## Commit discipline (Phase 2)

- HEAD `eaedca05`: `git rev-list --count HEAD ^HEAD~1` = 1; trailer present.
- `git status --porcelain | wc -l` = 17, all pre-existing `.png` screenshot artifacts under
  `pokered-app/` (party_screen_*, stats_page*) — not source, not touched by Phase 2; the same set
  the Phase-1 audit reconciled.
