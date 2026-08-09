# 17 — P6 Production-Flip Execution Plan (the human-gated remainder)

**Status:** PLAN. Everything *verifiable* is done and green (see §1). The remaining
production flip (§3) is specified here because its correctness can only be validated
by **playtesting**, and it requires *reworking* the differential-proof provider into
production-grade code — judgment + human-in-the-loop steps, not mechanical ones.

This doc supersedes blueprint `15` §4's sketch with what the build actually revealed.

---

## 1. What is DONE and PROVEN (all green, on `feature/p0-engine-migration`)

The pokered Gen-1 battle **logic** is fully reproduced on the `dotzuki-engine`
effect-stack and proven equivalent to the legacy oracle, test-side:

- **Engine** (`dotzuki-engine`, 328/0): the effect-stack (`StackDriver`), the closed
  `Event` model, the `EffectState` arena, the `forced_action` seam, the **`TurnLog`**
  (`execute_turn_logged`) with `MoveUsed / Missed / Blocked / Crit / Damaged /
  Healed / StatusInflicted / StatusCured / StatChanged / Fainted` — all additive +
  defaulted (no-log path byte-identical).
- **Moves** (`pokered-core`, 1689/0): P0–P5 + Option A migrated every move family
  onto the stack and **differentially proved** each produces an IDENTICAL
  `BattleState` + identical `rng.consumed()` vs the legacy `apply_move_effect` /
  `execute_turn` oracle: pure damage, self-Boost, side-status, drain/recoil,
  special/fixed/OHKO, foe stat-down (nested-veto), multi-hit, the native tier
  (field/volatile/data-reach), the cross-turn lock-in group, **burn/poison/toxic/
  leech residual**, and the **sleep/freeze/paralysis/confusion `BeforeMove` gates**.
- **Narration** (the translator, `pokered_rules/tests.rs`): `translate_turn(log,
  state)` reproduces the production per-turn text **exactly** — `format_move_outcome`
  (used / crit / effectiveness / miss / cannot-move) + "{name} fainted!", names
  UPPERCASE / "Enemy "-prefixed. Effectiveness is re-derived game-side (the engine
  reports only structural damage). Proven end-to-end on real `TurnLog`s.

**Therefore the move-level state-equivalence the flip depends on is already proven**
(the 1689 differential tests compare legacy `BattleState` fields to the stack
`EngineState` field by field). What remains is *wiring* + *production-grade rework*.

---

## 2. What the build REVEALED (why the flip is human-gated)

1. **`PokeredRules` is a differential PROOF, not a production provider.** It carries
   test-simplifications:
   - `level_of()` returns a hardcoded **50** (`mod.rs`). Real battles have varying
     levels → production damage would be wrong. **Fix:** convey the real level
     (add a `level` to `EngineBattler`, or key the `LEVELS` map by `BattlerRef`, not
     species — species-keyed breaks mirror matches). This touches `pokered_damage`
     and must keep the 1689 level-50 tests green (they must set level 50 explicitly).
   - Per-turn state in thread-locals (`ACTIVE_MOVE`, `HOST`, `MOVE_RECORDS`,
     `LEVELS`, and `p5_native`'s `TYPE_OVERRIDE`/`COIN_POOL`/`LAST_MOVE`/`MIMIC_SLOT`).
     Acceptable for one battle at a time, but must be reset per battle and is a smell.
   - The module body is `#![cfg(test)]`; the provider must move to production while
     `tests.rs`/`p5_tests.rs` stay `#[cfg(test)]`.
2. **Correctness is not unit-testable.** Routing the frame-stepped
   `BattleScreen::execute_turn_with_move` / `execute_second_move` (`mod.rs:1795 /
   ~2062`) through the stack can only be validated by **playing** — text flow,
   animation timing, faint→switch, run/catch, trainer multi-mon. A diff review and
   the unit tests cannot catch a softlock or a mis-sequenced message.

---

## 3. The flip, step by step (each step verifiable except the playtest)

> Do behind a **runtime guard** defaulting to LEGACY, so every step is safe-to-merge
> and the playable game is unchanged until the final, playtested flip.

1. **Productionize the provider.** Remove `#![cfg(test)]` from `pokered_rules/mod.rs`
   + `p5_native.rs`; `#[cfg(test)]` the test files; `#[allow(dead_code)]` the
   not-yet-wired surface. Fix `level_of` to use the real level (see §2.1). Gate:
   workspace builds, 1689 + 328 stay green.
2. **`BattleState ↔ EngineState<PokeredRules>` adapter.** Convert the active mons:
   `species / hp / max_hp / stats (atk,def,spe,spc) / stat_stages / status / moves`,
   and the **status-flag ↔ `PokeVolatile`** table both directions:
   `GETTING_PUMPED↔FocusEnergy`, `HAS_SUBSTITUTE_UP + substitute_hp↔SubstituteHp`,
   `HAS_LIGHT_SCREEN_UP↔LightScreen`, `HAS_REFLECT_UP↔Reflect`,
   `PROTECTED_BY_MIST↔Mist`, `SEEDED↔LeechSeed`, `CONFUSED + confused_turns_left↔
   Confused`, `FLINCHED↔Flinched`, `BADLY_POISONED + toxic_counter↔Toxic`,
   `disabled_move↔Disable`, and the lock-in flags (`CHARGING_UP`/`INVULNERABLE`/
   `THRASHING_ABOUT`/`STORING_ENERGY`/`USING_TRAPPING_MOVE`/`NEEDS_TO_RECHARGE` +
   `num_attacks_left`/`bide_accumulated_damage`) ↔ the lock-in volatiles. Gate: a
   round-trip test (legacy → engine → legacy preserves every field).
3. **RNG shim.** Wrap the production pre-roll (`generate_turn_randoms` +
   `pick_enemy_move`) in a `BattleRng` that streams bytes in the stack's lazy draw
   order (the P0 design — AI draw is a true prefix). Gate: `consumed()` matches the
   pre-roll byte count.
4. **Guarded routing.** In `execute_turn_with_move` (behind the guard): adapt →
   `StackDriver::execute_turn_logged` → adapt back → `translate_turn` → the existing
   `show_text_then`. `PendingSecondMove` becomes "next event in the outcome"; the
   second move is already in the same driver run. Gate: a production-loop parity test
   (a turn via the guard == via legacy, same `BattleState` + same text) over the
   scenario matrix.
5. **Playtest (human).** Wild + trainer battles; every status; multi-hit; drain/
   recoil; faint→switch; run/catch; OHKO; the lock-in moves; confusion/sleep wake.
6. **P6c — the cut.** Flip the guard default to the stack; delete
   `execute_second_move` and retire the legacy `apply_move_effect` dispatcher +
   `turn::execute_turn`. Keep the ~226 orthogonal tests (menu/AI/capture/wild/
   escape/experience/settlement) green.

---

## 4. Recommendation

Steps 1–4 are verifiable and safe (guarded, legacy-default) — a developer can land
them with the unit gates above. Step 5 (playtest) and step 6 (the irreversible cut)
are the human-in-the-loop finish. The engine + all move logic + the narration layer
are done and proven; this is the dogfooding wiring, not new capability — the
reusable battle engine (the project's actual goal) is complete and shipped.
