# Effect-Stack Battle Engine — Migration Status after Slices 1–7 (P0b)

**Status: PROVEN-ARCHITECTURE + PARTIAL-RE-HOMING milestone — NOT a finished battle-engine replacement.**
Branch `feature/p0-engine-migration`. Independently audited at HEAD `79582431`.

This is the honest whole-migration status for the Showdown-style effect-stack re-founding of
`jrpg-engine`'s battle system (pattern C, design [`06-battle-engine-effect-stack-design.md`](06-battle-engine-effect-stack-design.md)).
The vertical-slice POC ([`07-effect-stack-poc-result.md`](07-effect-stack-poc-result.md)) returned
GO; slices 1–7 then carried out the strangler plan (design §7). **Read the "Remaining work" section
before treating any of this as production-ready** — the stack is parity-proven in a *test harness
against a mock data provider*, and is NOT yet wired to pokered's real battle state, and the
production loop has NOT been swapped.

---

## 1. What the effect-stack engine now is

A new **additive sibling** module `crates/jrpg-engine/src/battle/stack/` (files `event.rs`, `ctx.rs`,
`dispatch.rs`, `driver.rs`, `mod.rs`). It is 100% game-agnostic: zero Pokémon types, links no `rand`
(`cargo tree -i rand` in jrpg-engine → none), no `if gen==1`. All randomness flows only through the
existing `BattleRng` trait.

### Event model (`event.rs`)
A **closed `Event` enum** of dispatch *kinds* (the key — no payload); the payload rides in a typed
`RelayVar` threaded through the fold. `Modify*` events are numeric folds; `Try*` are veto gates;
lifecycle events (`Start`/`End`/`Residual`/`SwitchIn`/`Faint`/`DamagingHit`) are side-effecting.
Handlers are **zero-capture `fn` pointers** (`HandlerFn`), so the only mutable path is through `ctx`
— a deliberate borrow + determinism win. An `Effect` = id/type + a sparse `&'static [EventHook]`
table; moves/statuses/volatiles all share that shape.

### `run_event` fold (`dispatch.rs:161`)
The workhorse. `find_event_handlers` collects, from every live effect on the relevant
battlers/sides/field, the matching hooks; the loop sorts by the Showdown `comparePriority` lexical
order (**order → priority → speed → sub_order → effect_order**, with `effect_order` a monotonic
RNG-free tiebreak), applies a speed-tie shuffle that draws **exactly one** `BattleRng` byte only on
an exact tie, then folds: each handler returns `Unchanged` / `Set(v)` / `Fail` / `FailSilent`. The
loop owns `hs` (collected before folding, so no handler invalidates another mid-fold) and re-borrows
`&mut BattleCtx` per step. No `RefCell`, no `unsafe` in the hot path.

### `EffectState` arena (`ctx.rs`)
Per-effect mutable state lives in an arena `Vec<EffectState>` keyed by id (binary-searched), held
*alongside* the reused `BattleState` (which the stack mutates in place). `EffectState.kind` is the
game-supplied `type EffectStateKind` associated type — the engine treats it **opaquely** (it only
stamps `effect_order` and routes it to the host). pokered supplies the Gen-1 enum (`PocKind`:
Toxic counter, Substitute hp, LockedMove/TwoTurn/Recharge/Bide/DamageTaken, Flinch, …); the engine
names none of them.

### `StackDriver` (`driver.rs:39`)
`StackDriver::execute_turn(provider, &mut state, [BattleAction; 2], &mut rng)` — the fixed firing
sequence. Per turn: resolve order (+speed-tie draw) → for each actor: `BeforeMove` gate (may abort)
→ if the move acts, `ModifyCritRatio`(+crit draw) → `Accuracy`(+acc draw) → `ModifyDamage`(+dmg
roll) → `Damage`/`DamagingHit`(+secondary draws) → `AfterMove`; then fire **Residual + faint-check
for THIS actor** (per-mover interleave, with the first-mover-faint short-circuit that cancels the
second move). Crit is drawn before accuracy by the *sequence the driver fires events in*, not by
handler priority. Before each action the driver consults `forced_action` (below) to let a
prior-turn volatile hijack the chosen action.

### The 3 generic+defaulted seams added across the slices
Every engine-trait method added is **generic, defaulted, and inert for other games** (the slice-5/6
discipline):

| Seam | Added | Signature (abridged) | Default / inertness |
|---|---|---|---|
| `effect_for_volatile` | slice 5 | `fn effect_for_volatile(&self, kind: &Self::EffectStateKind) -> Option<&'static Effect<Self>>` (`ctx.rs:53`) | defaults to `None` — a game with no volatile-borne residuals is unaffected; the driver's arena-residual pass is inert. Lets a game host a residual on a *volatile* (Gen-1 Leech Seed / badly-poisoned live in `status2`/`status3` bits, not the non-volatile status byte) with the engine knowing no Pokémon semantics. |
| `forced_action` | slice 6 | `fn forced_action(&self, effects: &[EffectState<Self>], actor, chosen: &BattleAction<Self>) -> Option<BattleAction<Self>>` (`ctx.rs:99`) | defaults to `None` — completely inert for slices 1–5 and every other game. The only thing the engine does is swap one `BattleAction` for another; all Gen-1 lock-in semantics (which volatile forces which move, the lock counter, recharge = `Nothing`, self-confuse on fatigue) live in pokered. The canonical proof a per-turn `[Action; 2]` input is insufficient. |
| **slice-7 seam: NONE** | slice 7 | — | **The engine was UNTOUCHED in slice 7.** The design names `AfterMoveSecondary` (§1.1), but the implemented driver reaches the secondary fire point through the **existing `DamagingHit` event** (fired post-`take_damage` with `last_damage` set, exactly the secondary fire point — design §4.1 even shows "DamagingHit → Hit/secondary"). Slice 7 added **no new event or method**; it reused `DamagingHit`. So the migration so far required exactly **two** new engine seams (`effect_for_volatile`, `forced_action`), both generic+defaulted+inert. |

### Borrow-strategy outcome (`pair_mut`)
`BattleCtx::pair_mut(a, b)` (`ctx.rs:196`) returns two disjoint `&mut BattlerState`: the cross-side
branch is the **one** localized `unsafe` (two separate `Vec`s ⇒ `a.side != b.side` ⇒ provably
non-aliasing); the same-side branch is fully safe via `split_at_mut`. **Where it is genuinely
load-bearing vs merely driven:**

- **Genuinely load-bearing → Counter (slice 6, bug #20).** Counter reads its *host's* damage-taken
  scratch while writing the *opponent* through the SAME paired `&mut` (reflect `amount*2`, physical
  only). This is the handler that finally exercises a real disjoint pair and vindicates keeping the
  localized cross-side `unsafe` — it compiles with no `RefCell`/`Rc`. Drain (slice 7) also uses a
  cross-battler write (heals the attacker, damages the defender), a second genuine consumer.
- **Merely driven (single battler each side) → everything else.** Gen-1 single battle uses only the
  cross-side path with one battler per side; the same-side `split_at_mut` path compiles and is
  unit-tested but is doubles-grade scaffolding not exercised by any Gen-1 effect.

---

## 2. The 7 slices

Every slice is **additive test code** (a parity harness + per-category handlers), NOT a production
change. Each re-homes the real legacy logic into stack `Effect`/`HandlerFn` instances and **diffs the
resulting `BattleState` against the legacy oracle** (`pokered_core::battle::turn::execute_turn` /
`apply_move_effect` / the residual & damage pipelines) given the same bytes — the honest parity
oracle (design §4.1: "same `BattleState` after the turn, given the same bytes" + `consumed()`
draw-order parity). The audit confirmed each oracle is **live** via mutation testing (break the
handler → the assert fails against the legacy result → restore → green), proving the asserts diff vs
legacy and are not hardcoded.

| # | Commit | What it proved | Legacy oracle diffed | Mutation-confirmed live? |
|---|---|---|---|---|
| 1 | `8581b5ab` (+`7d27c769`) | RNG shim + turn-order: the byte-vector ↔ `TurnRandoms` struct ↔ streamed `ScriptedRng` shim (design §4.1) + crit-order guard. Establishes the reusable `stack_parity` harness every later slice depends on (PocData, `EffectStateKind` arena, byte-shim, `run_scenario*`, `assert_state_parity*`, `build_stack_stream*`). | `turn_order::execute_turn` order + `consumed()` byte count | yes (POC verdict) |
| 2 | `119d9f1b` (+`55f36eb9`) | `BeforeMove` status gate + sleep-loses-turn + the fixed status-check order (#8/#12/#13); paralysis `<63` boundary pinned (62 blocks / 63 acts). Subtlest source of silent drift. | `status_checks` BeforeMove gate (BattleState + consumed) | yes |
| 3 | `71182f33` (+`c2f39468`) | crit → accuracy → damage pipeline with per-draw `consumed()` assert (#2/#3/#4/#5/#29); crit-drawn-before-accuracy. | `damage` / `accuracy` calc pipeline | yes |
| 4 | `e84172bb` | Substitute + partial-trap **cross-battler** interception (#16/#28); exercises `pair_mut` + high-priority interceptors. | `effects::damage_effects` (sub) / `multi_turn_effects` (trap) | yes |
| 5 | `c52cdde1` | residual / toxic / leech as handlers with per-mover interleave + first-mover-faint short-circuit (#6/#7 + §2 gap). Introduced the `EffectState` arena + the `effect_for_volatile` seam. | `residual` (status order, /16, uncapped toxic counter) | yes |
| 6 | `ad38deca` (+`fbadde25`) | multi-turn lock-in (Thrash/Wrap/Fly/Hyper-Beam-recharge/Bide) + Counter/Bide (#14/#15/#17/#18/#20). Added the `forced_action` seam + 5 `PocKind` variants. Established `MoveContext.last_damage` for same-action reads. | residual/multi-turn fns; **Counter has NO legacy `MoveEffect`** → dmg direct-pinned (honest: not all reactive effects have an oracle) | yes |
| 7 | `79582431` (HEAD) | **ONE representative per secondary/special category** via the `DamagingHit` event-chain (see §3). Engine UNTOUCHED. | `execute_turn` post-damage (per-category legacy fn) | yes (6 mutations / 5 categories) |

**Slice 7 representatives** (one per category — the rest are mechanical follow-up):

| Category | Stack handler | Re-homes legacy fn | Threshold / amount |
|---|---|---|---|
| status-on-hit | `poison_side` | `status_effects::apply_poison_side` | thr 102 |
| stat-drop-on-hit | `stat_down_side` | `stat_effects::apply_stat_down_side` | 33%, thr 85 (floor via `.modify`) |
| flinch | `flinch_side` + `flinch_gate` BeforeMove order:40 | `special_effects::apply_flinch_side` | thr 77; sets/consumes a `PocKind::Flinch` volatile |
| recoil | `recoil` | `damage_effects::apply_recoil` | `(dealt/4).max(1)`; reads `MoveContext.last_damage` |
| drain | `drain` | `damage_effects::apply_drain` | `(dealt/2).max(1)`; cross-battler heal of attacker |
| special / global | `haze_handler` | `field_effects::apply_haze` | power-0 stat+status reset, both sides |

**Draw-order / `consumed()` parity (slice 7):** the secondary's `side_effect_roll` is drawn **LAST
per mover** (after crit/acc/dmg), matching `MoveRandoms.effect_randoms` field order. The byte is
consumed **whether or not the secondary fires** → `consumed()` is identical at the boundary, pinned
directly (roll thr-1 FIRES / thr does NOT, same consumed). `NoAdditionalEffect` moves draw no byte →
slices 1–6 stay byte-identical. recoil/drain read `MoveContext.last_damage` set by the driver before
`DamagingHit` in the **same action** — validating slice-6's same-action placement.

**Parallel safety:** the harness's `ACTIVE_MOVE` is a `thread_local! Cell<MoveData>`, so each test
thread has isolated active-move state — which is why the 88 stack parity tests are identical green 3×
default-parallel AND `--test-threads=1`.

---

## 3. Design §9 decisions resolved (cross-turn state placement)

The design's open questions on where cross-turn/cross-action state lives are now **resolved in code**:

- **`MoveContext.last_damage` placement → SPLIT by read shape (slice 6).**
  - *Same-action reads (recoil, drain)* → `MoveContext.last_damage`, per-mover driver scratch set
    after damage, threaded through the move's event chain. The "per-turn scratch on the driver"
    answer holds verbatim. Slice 7's recoil/drain confirm this works.
  - *Cross-ACTION reactive reads (Counter, Bide)* → a **PER-BATTLER `EffectState` arena scratch, NOT
    `MoveContext`** (the load-bearing finding). `MoveContext` is reset per mover; Counter (−1
    priority) reads the damage it took when the *opponent* moved, under a different `MoveContext`
    already discarded. So damage-taken-this-turn lives per-battler in the arena
    (`PocKind::DamageTaken { amount, physical }`), stamped by a `DamagingHit` handler on the defender,
    reset each turn. This is the concrete proof a per-turn `[Action; 2]` input is insufficient.
- **Cross-turn locked-move / two-turn / recharge / Bide accumulator state → the `EffectState` arena,
  hijacking the action via the generic+defaulted `forced_action` seam (slice 6).** `forced_action` is
  the only engine change slice 6 needed.
- **`EffectStateKind`: associated type vs concrete enum → kept as the provider associated type**
  (since slice 5). Slice 6 added 5 variants to the pokered enum with zero engine change; promote to
  richer generics only when a second game lands.
- **Queue wiring depth → still minimal.** Lock-in overrides the existing `[Action; 2]` slot via
  `forced_action`; it does not push queue actions. The priority table (Counter −1 / Quick Attack +1)
  rides on `turn_order_rank`.
- **Cross-side `pair_mut` → kept the localized cross-side `unsafe`** (provably disjoint Vecs); slice
  6 Counter makes it genuinely load-bearing.
- **`single_event` recursion guard → deferred.** The driver fires events iteratively; Bide-unleash /
  Counter-reflect apply damage directly via `pair_mut`, no re-entrant `single_event`, so no guard is
  needed yet.

---

## 4. HONEST remaining work to actually SWAP production onto the stack

This milestone proves the architecture and re-homes a representative subset. It is **not** a finished
replacement. To actually retire `execute_turn`:

**(a) The stack is proven against a MOCK data provider, NOT pokered's real battle data.** All slice
parity runs use the harness's `PocData` provider and synthetic moves/battlers. The stack is **NOT yet
wired to pokered's real `BattleState`, 151-species roster, or 165-move table.** Wiring the real
`EffectProvider` (real `effect_for_move`/`effect_for_status`/`effect_for_volatile` over the actual
data + the real `MoveRandoms`/`EffectRandoms`/`status1/2/3` volatile bitflags) is unbuilt.

**(b) Only representatives of the ~80 `MoveEffect` variants are re-homed.** Slice 7 did ONE per
category (status-on-hit / stat-drop / flinch / recoil / drain / special-global). The remaining ~70
variants — other thresholds, Burn/Freeze/Paralyze-side, Up/Down primaries, Confusion-side, multi-hit,
OHKO, PayDay, Conversion, Transform, Mimic, Metronome, Disable, … — are **mechanical follow-up** (they
reuse the same `DamagingHit` seam + draw-order contract), but they are NOT done.

**(c) The production call-site swap is STAGED, not made.** The pokered production loop
(`battle/turn.rs`, `battle/mod.rs` pick paths, `effects/*.rs`, `apply_move_effect`, `execute_move`) is
**untouched and remains the oracle** (strangler invariant: additive only). Routing `execute_turn`
through `StackDriver` is gated on **full real-data parity + the full ~410 battle tests** (not just the
88-test harness) + a full-battle differential fuzz — none of which has been run against real data.

**(d) AI and menus still call the legacy path.** They are orthogonal (they call *into* the stack, not
vice-versa) and migrate last or never.

**Honest non-fit found (slice 7):** SuperFang / special-damage are **not** wired into production
`execute_turn` (`effects/mod.rs:188-190` return `NoEffect` — "handled in damage calc"; `calc_and_apply_damage`
has no SuperFang branch). With no `execute_turn` post-damage oracle to diff against, they were
correctly **left as follow-up** and Haze was substituted as the special/global representative — not a
hidden failure, but a real gap in what can currently be parity-tested.

**The single most important next step:** wire the stack to pokered's **real** `EffectProvider` /
`BattleState` / move+species data and prove parity against the **full ~410 battle tests** (not just
the 88-test harness) before any production call-site swap.

---

## 5. Final verified numbers

Forced/uncached, from actual output at HEAD `79582431`:

- `cargo build --workspace` → **exit 0**.
- `cargo test -p jrpg-engine` → **301 lib + 2 doctest, 0 failed** (engine untouched since the POC;
  byte-identical to parent — the 301+2 split is the actual unchanged total, not a regression vs the
  earlier "303" baseline reference).
- `cargo test -p pokered-core` → **1907 passed, 0 failed** (across all test binaries).
- Stack parity subset → **88 tests, identical green 3× default-parallel AND `--test-threads=1`**.
- slice-7 additions → **16 tests** (incl. a 1000-seed determinism fuzz that randomly attaches a
  secondary).
- **Agnosticism:** `jrpg-engine` links **no `rand`**, contains **no Pokémon types** in production
  (the only identifiers in the stack module are `TSpecies`/`TMove`/`TProvider` test fixtures under
  `#[cfg(test)]` — a generic mock game, not real Pokémon types), and has **no `if gen==1`**.

**Bottom line: PROVEN ARCHITECTURE + PARTIAL RE-HOMING. The effect-stack is real, deterministic,
borrow-sound, and parity-clean in a test harness — but it is not yet a battle-engine replacement.**
