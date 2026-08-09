# P0 Engine-Gap Migration — Completion Report

## Update 2026-06-02 — Problems addressed (fix pass)

A dedicated fix pass closed out the "Problems / nits surfaced by the reviews"
section. Branch `feature/p0-engine-migration`; five commits since baseline
`2c65f92c`; tree clean. Forced/uncached verification (`touch` changed files →
rebuild): `cargo build --workspace` exit 0; **`jrpg-engine` 292 pass / 0 fail**
(lib unittests; +2 doc/integration pass), **`pokered-core` 1821 pass / 0 fail**
(summed over all binaries; +17 over the 1804 baseline). `jrpg-engine` still links
no `rand` (`cargo tree -p jrpg-engine -i rand` finds nothing) and the changed
engine modules carry zero Pokémon identifiers outside `#[cfg(test)]` (only an
illustrative "Pokédex id" doc comment in `party/mod.rs`).

| P0 | Problem | Status | Commit |
|----|---------|--------|--------|
| P0a | Engine level-up not a Gen-1 drop-in (HP-delta growth + move-learning); overclaiming doc; tautological test | ✅ **FIXED** — two defaulted `ExpProvider` hooks (`levelup_current_hp`, `learn_moves_on_levelup`), provider overrides match `process_level_up`, differential test replaces the tautology | `5210d6e1` |
| P0b | Crit hardcoded `false` in Damage event (provider crit can't surface) | ✅ **FIXED** — defaulted `roll_critical` hook; driver rolls + emits it; 2 driver tests | `794af386` |
| P0c | Weak AI parity (only empty/all-tied layer covered) | ✅ **FIXED** (test-only; no engine change needed) — parity test on a non-empty Layer3 with a 2-move winner subset vs production `choose_moves`+`pick_move` | `f168e633` |
| P0d | Pre-existing repel bug (`party_lead_level: 5` hardcoded); thin encounter parity | ✅ **FIXED** — real lead level threaded via new `OverworldScreen` field synced in app; +6 parity tests (water + cave) | `2dc9b735` |
| P0e | Shallow `apply_effect` parity (only Poison); shop-driver overclaim | ✅ **FIXED (with documented divergence)** — `apply_effect`-routed parity for all cured statuses + Full Heal + edge cases; fainted-target divergence **documented, not asserted equal**; honesty docs added | `55c2ba87` |

**Honesty notes carried forward (not regressions):**
- **P0b/P0b parity:** the original "no parity test for P0b" gap was addressed by
  surfacing crit into the event stream + 2 driver tests, **not** by a full
  differential RNG-draw/event-stream parity test against the live `engine.rs`/
  `turn_order.rs` loop. pokered's live turn loop still does **not** route through the
  engine driver, so that end-to-end parity remains **⏳ STILL-STAGED**.
- **P0d fishing parity:** added water + cave (both genuinely reachable through the
  harness); **fishing parity is ⏳ STILL-STAGED / not reachable** — fishing is a
  separate rod-based path that never flows through `check_wild_encounter` /
  `EncounterEngine::on_step`. Cemetery is just a grass table (covered by classification).
- **P0e non-cure routing:** HP heal / PP / vitamins / Rare Candy still return
  `NoEffect` through `apply_effect` by design (need Pokémon-only data) — ⏳ STILL-STAGED,
  now explicitly documented as a swap hazard. Fainted-target cure genuinely diverges
  (legacy `hp==0` guard vs generic probe) and is documented rather than asserted equal.
- **All five production call-site swaps remain ⏳ STAGED** (see the Consolidated
  STAGED follow-ups section) — the fix pass hardened the engine layer + parity, it did
  not move the hot path.

---

**Date:** 2026-06 · **Scope:** the four P0 gaps from [`00-SUMMARY.md`](00-SUMMARY.md)
(battle driver, battle AI, party/monster model, wild encounter, item effects).

**One-line status:** the **generic engine layer + pokered provider impls + parity
tests are landed and green** for all five systems; the **production call-site swaps
are mostly STAGED** (engine code is additive — pokered still runs its own legacy
loops/paths in production). *Staged means staged.* This report is an honest
DONE-vs-STAGED accounting, drawn from five adversarial reviews of the landed code.

---

## Verified facts (the green baseline)

| Check | Result |
|---|---|
| `jrpg-engine` tests | **290 pass / 0 fail** (original baseline) → **292 pass / 0 fail** after fix pass |
| `pokered-core` tests | **1802 pass / 0 fail** (original baseline) → **1821 pass / 0 fail** after fix pass |
| Workspace build | **clean (exit 0)** |
| `jrpg-engine` links `rand` | **No — not even transitively** (`cargo tree -p jrpg-engine` shows no `rand`; `Cargo.toml` = `serde`/`thiserror`/`image` only). RNG flows through the `BattleRng` trait. |
| Pokémon identifiers in the new engine modules | **Zero** in production code (grep confirms no `Species`/`MoveId`/Pokémon types; the only `Potion`/`Antidote`/`Gen-1` hits are in `#[cfg(test)]` mocks or doc comments). |

The ~1800 pokered tests stay green **because nothing in the hot path moved** — i.e.
by construction (the engine layer is additive and unwired), not because production
now flows through the new layer.

---

## Per-system breakdown

### P0a — Party / monster model · commit `792c8410`
**New engine module(s):** `crates/jrpg-engine/src/party/` — `monster.rs`
(`Monster`, `MonsterStatus`, `recalc_stats`, `gain_exp`), `party.rs`
(`Party::new(capacity)`, `BoxStore::new(box_count, box_capacity)`), `mod.rs`
(traits), `tests.rs`.
**Key traits/types:** `MonsterProvider` (stat formula, base stats, HP-stat identity,
`max_moves`), `ExpProvider` (EXP curve), `EvolutionProvider` (evolution conditions).
All capacities are constructor params — no `6`/`12`/`151` hardcoded.
**Provider impl + parity:** `examples/pokered/crates/pokered-core/src/pokemon/engine_adapter.rs`
(`PokeredMonsters`, round-trip adapter). Real parity tests: `stat_calc_matches_pokered`
(`:373`), `exp_provider_matches_pokered` (`:393`), `evolution_via_engine_matches_settlement`
(`:415`).
**DONE:** agnostic, rand-free, additive (commit only adds files + one `mod party;`
line — no existing trait touched); provider stat/exp/evolution math is **pure
delegation** to legacy `calc_all_stats`/`exp_for_level`/`check_level_evolution`.
**STAGED:** the step-3 re-point of the `Pokemon` struct onto the engine `Monster`
model. Production leveling still flows exclusively through `gain_experience` →
`process_level_up`; the only reference to any adapter symbol outside its own file
is in a `#[cfg(test)]` block (`items/use_engine.rs:275`).
**PROBLEM / nit to fix before swap:** ✅ **FIXED** (commit `5210d6e1`). The engine
level-up is now a Gen-1 drop-in via two **defaulted** hooks on the existing
`ExpProvider` trait: `levelup_current_hp(old_max, new_max, current)` (default = the
prior clamp `current.min(new_max)`) and `learn_moves_on_levelup(species, level,
&mut Vec<MoveSlot>)` (default = learns nothing). `LevelUp` gained a `learned_moves`
field; `gain_exp` captures old max HP, applies the HP-policy hook (re-clamped to new
max), and collects learned moves per level crossed. `PokeredMonsters` overrides both
to match `process_level_up` exactly (HP grows by saturating max-HP delta; same
`evos_moves` learnset lookup with skip-known / first-empty-slot / replace-last + PP
from MOVES). The overclaiming doc comment (`engine_adapter.rs:14-20`) was reworded.
The near-tautological `gain_exp_via_engine_levels_up` was **replaced 1:1** with
differential test `gain_exp_matches_process_level_up`: a damaged Bulbasaur (L6,
HP=max/3) leveled to L9 through both paths, asserting equal current/max HP, level,
all stats, move slots, PP arrays, and learned-move set. *Documented edge case (does
not arise in production data):* the engine's `Vec<MoveSlot>` move model matches legacy
`[MoveId;4]` placement only when move arrays are packed front-to-back (always true in
normal play; the differential test uses a packed array). Secondary nit:
`MonsterStatus` (`monster.rs:11-25`) is a fixed Gen-1-shaped enum
(Healthy/Sleep(u8)/Poison/Burn/Freeze/Paralysis) — still a minor, documented,
lossy-mappable leak (non-volatile status set is not provider-supplied), **not
addressed** in this pass.
**Verdict: FIXED (was SOUND-WITH-NITS).**

### P0b — Battle turn-execution driver · commit `60c9477a`
**New engine module(s):** `crates/jrpg-engine/src/battle/driver.rs` (`BattleDriver`,
`execute_turn`, `BattlerRef`, `BattleEnd`), `battle/rng.rs` (`BattleRng` trait,
`ScriptedRng` test double), `battle/mod.rs` (hooks). 3 files, +1248 lines, 0 in
`examples/`.
**Key traits/types:** four **defaulted** hooks added to the existing `BattleProvider`
(`mod.rs:468-528`, each `where Self: Sized`): `turn_order_key` (→ `OrderKey`),
`before_move`, `accuracy_check`, `end_of_turn`. RNG injected as `&mut dyn BattleRng`.
**DONE:** agnostic, rand-free, properly defaulted (existing mock-RPS tests and the
real `PokemonRedData` impl compile unchanged); 9 driver + 6 rng tests are genuine
behavioral tests (turn order, tie-break, sleep-gate, damage-via-hook, miss, residual
count, faint short-circuit, switch swap, draw-order determinism) against a toy
`DProvider`.
**STAGED:** **everything downstream** — there is **no pokered driver wiring**. The
real provider `examples/pokered/crates/pokered-data/src/impl_traits.rs:1065`
overrides **none** of the four new hooks (uses defaults). pokered's live turn loop
still runs through `battle/turn_order.rs` / `engine.rs` / `turn.rs` (untouched).
**PROBLEM / nit:** **PARTIALLY ADDRESSED.**
- ✅ **FIXED** (commit `794af386`): the hardcoded `critical: false` event-fidelity
  gap. A defaulted `BattleProvider::roll_critical(&self, state, who, target, move_,
  rng) -> bool` hook was added (`where Self: Sized`; default returns `false` and draws
  **no** rng, so every existing provider's draw sequence is preserved). `resolve_fight`
  in `driver.rs` now rolls `roll_critical` **before** `calculate_damage`, passes it as
  the `is_critical` arg, and emits it in the `Damage` event. Two driver tests prove a
  crit-always provider surfaces `critical:true` + doubled damage and the default keeps
  `critical:false`.
- ⏳ **STILL-STAGED:** the headline gap — a **differential parity test** driving a real
  pokered battle through `BattleDriver::execute_turn` vs the legacy `engine.rs`/
  `turn_order.rs` loop, reconciling the engine tie-break ("smaller `tiebreak` acts
  first", `mod.rs:281`) against real Gen-1 `random_byte < 128 → PlayerFirst`
  (`turn_order.rs:40-45`) and the draw count/order — was **not** added. pokered's live
  turn loop still does not route through the engine driver, so no pokered behavior
  changed; equivalence remains asserted-not-demonstrated end-to-end. Secondary nits
  (2-sided `[PLAYER, OPPONENT]` layout, slot-0-only switching, `driver.rs:236-240,
  397-400`) **not addressed**.
**Verdict: PARTIALLY FIXED (event-fidelity crit gap closed; full battle-loop parity
still staged).**

### P0c — Battle AI driver · commit `9b6d561e`
**New engine module(s):** `crates/jrpg-engine/src/battle/ai.rs` (327L) + `mod.rs`
(+2). 4 files, +616 lines, additive.
**Key traits/types:** **brand-new** `BattleAiProvider` trait (`ai.rs:42-72`,
`score_action -> i32`, `legal_actions -> Vec<BattleAction>`) — NOT a modification of
`BattleProvider`. `BattleAi::choose` (`ai.rs:91-133`) is pure argmax + RNG tie-break
(one `rng.range()` draw). Re-exported at `mod.rs:31`.
**Provider impl + parity:** `examples/pokered/crates/pokered-core/src/battle/trainer_ai/engine_ai.rs`
(`TrainerAiProvider`, parity test at `:239-285`). The parity harness's `pokered_pick`
(`:233`) calls the **real production** `choose_moves` + `result.pick_move` — the exact
functions production uses. **Strongest parity comparison of the five.**
**DONE:** agnostic, rand-free, additive (new trait, no retrofit); engine unit tests
prove argmax, "unique best draws no rng" (`rng.consumed()==0`), rng-driven ties,
empty→`Nothing` fallback.
**STAGED:** production `pick_enemy_move` (`battle/mod.rs:690-718`) still selects via
`choose_moves` + `pick_move(rand::random::<u8>())` and the wild fallback
`rand::random::<usize>() % available.len()`. `TrainerAiProvider` / `BattleAi::choose`
have **zero non-test references** in the repo.
**PROBLEM / nit:** ✅ **FIXED** (commit `f168e633`, test-only — **no engine change
was required**). Added parity test `engine_choose_matches_pokered_pick_on_non_empty_layer3`
in `engine_ai.rs` using a **non-empty** layer set (`[Layer3]`) with a **non-trivial
winner subset**: an Electric attacker `[Tackle, Thunderbolt, Thunder, Pound]` vs a
Water defender, so Layer3 narrows to the two super-effective moves (subset {1,2}). It
drives both the engine path (`BattleAi::choose` over `TrainerAiProvider`) and the
**real production** selection (`choose_moves` + `MoveChoiceResult::pick_move`, the same
functions `pick_enemy_move` at `battle/mod.rs:704-712` uses), asserting the chosen
`MoveId` matches **and** `rng.consumed()==1` for `rand_val` in
`[0,1,2,3,7,50,100,255]`. A sanity assertion pins the candidate subset so the layer is
genuinely exercised. *Why no engine change:* the flat-score `TrainerAiProvider` already
derives its candidate set from the real `choose_moves` scorer and ties over exactly the
winner set, so `BattleAi::choose` draws `rng.range(count)==rand_val%count`, identical
to `pick_move(rand_val)`, for any non-flat winner subset of size ≥2. Design note (not a
defect): `BattleAiProvider: BattleProvider` still forces 5 unused stubs — documented.
**Verdict: FIXED (was SOUND-WITH-NITS).**

### P0d — Wild encounter + handoff · commit `829b0800`
**New engine module(s):** `crates/jrpg-engine/src/overworld/encounter.rs`
(`EncounterEngine::on_step`, `EncounterProvider`, `EncounterStep`, `EncounterMode`,
`EncounterContext`).
**Key traits/types:** `EncounterProvider` (new trait, required `roll_encounter` /
`is_encounter_tile`); `type Species: Copy + Eq + Debug` (engine never inspects it,
only forwards `(Species, u8)`); `EncounterMode::Fishing { rod_power: u8 }` opaque to
the engine. RNG via `BattleRng`.
**Provider impl + parity:** `examples/pokered/crates/pokered-core/src/overworld/wild_encounters.rs`
(`PokeredEncounterProvider`) — all Gen-1 quirks stay here (slot thresholds, `random
>= rate` miss, repel `< party_lead_level`, indoor/Forest exception, slot-clamp).
Parity tests `tests_wild_encounters.rs:543-795`: `assert_encounter_parity` (`:557`)
drives the **real** legacy `check_wild_encounter` and `on_step` over the **same RNG
stream** and asserts species+level equality — genuine, draw-order-faithful, not
tautological; RepelBlocked→None and zero-RNG-gate cases covered.
**DONE:** agnostic, rand-free, parity-proven mechanism. **Best-substantiated of the
five** (engine instantiated and exercised end-to-end by the parity tests).
**STAGED:** production `check_wild_encounter_on_step` (`overworld/update.rs:1968-2010`)
still uses `rand::Rng` directly (`self.rng.gen_range`) and the legacy table path; no
production consumer of `EncounterEngine`/`on_step`.
**Reason swap deferred (real, correctly identified by the commit):** legacy draws
**both** RNG bytes unconditionally up front (`update.rs:1982-1983`, before any
eligibility check), whereas `on_step` **gates first** and consumes **zero** RNG on
ineligible tiles (`encounter.rs:110-112`). Routing live code through `on_step` would
change the RNG draw count on every non-grass step and **desync the stream**.
**PROBLEM / nit (independent of staging — flag for the swap):** ✅ **FIXED** (commit
`2dc9b735`). The pre-existing repel bug — production hardcoded `party_lead_level: 5` in
`check_wild_encounter_on_step` (`overworld/update.rs`) — is fixed live: a new
`pub party_lead_level: u8` field on `OverworldScreen` (mirrors the existing
`party_count`) is consumed by `update.rs`, and `pokered-app/src/game.rs` now syncs
`overworld.party_lead_level = save_data.party.leader_level()` at all four sites where
it syncs `party_count`. (`pokered-core` only carries `party_count`; the full party
lives in the app/save layer — hence the field + app sync.) No test encoded the old
level-5 behavior, so the production change is live. Parity harness extended with **6
new** draw-order-faithful tests (reusing `assert_encounter_parity`): WATER table
(Surfing on Route19, hit/miss/repel-blocked) and IndoorCave classification (MtMoon1F
via Cavern tileset → grass table, hit/miss/repel-blocked); repel-blocked cases use lead
level 100 so the block genuinely fires. ⏳ **STILL-STAGED:** fishing parity — fishing is
a separate rod-based path (`good_rod_data`/`super_rod_groups`) that never flows through
`check_wild_encounter` / `EncounterEngine::on_step`, so it is not reachable through this
harness; cemetery is just a grass table (covered by classification). Note: `pokered-tui`
never synced `party_count` and still doesn't sync `party_lead_level` (uses the 0
default — same effective behavior it always had, no regression).
**Verdict: FIXED (repel bug live + water/cave parity; fishing unreachable, staged).**

### P0e — Item-effect + bag/shop driver · commit `4413363f`
**New engine module(s):** `crates/jrpg-engine/src/items/use_driver.rs` (`use_item`,
`buy`, `sell`, `UsageContext`, `ItemUseResult`, `ShopError`, `ShopReceipt`) +
`items/mod.rs` trait additions. 4 files, +1195 / −0; only pokered change is one line
`pub mod use_engine;`.
**Key traits/types:** four **defaulted** trait methods — `ItemProvider::usable_in`
(→ `FieldAndBattle`), `ItemProvider::apply_effect` (→ `NoEffect`)
(`mod.rs:188-215`); `ShopProvider::buy_price` (→ 0), `sell_price` (→ buy/2),
`can_sell` (→ true) (`mod.rs:249-271`). `use_item` is pure routing (ownership →
`usable_in` gate → opaque `apply_effect` → conditional `remove`); buy/sell are pure
money/inventory bookkeeping. RNG via `&mut dyn BattleRng`.
**Provider impl + parity:** `examples/pokered/crates/pokered-core/src/items/use_engine.rs`
(`PokeItemProvider`, `PokeShopProvider`, `PokeredMonsters`). Parity tests
(`:296-444`): `potion_heal_parity` (`:296`), `vitamin_parity` (`:385`),
`antidote_cure_parity_via_use_item` (`:330`, the only one routing through the new
`use_item`/`apply_effect` driver), shop buy/sell (`:406-444`).
**DONE:** agnostic, properly defaulted (existing `MockItemProvider`/`MockShopProvider`
compile untouched), rand-free; driver contract well-tested (consume-on-Applied,
no-consume on NoEffect/Failed/wrong-context/not-owned, Caught-consumes, buy/sell
atomicity).
**STAGED:** production bag/battle/mart UIs (`pokered-ui/src/menus/{bag,battle_bag,
mart}.rs`), `MartState`, `inventory::use_item` still drive legacy per-effect paths;
no production caller of `use_item`/`buy`/`sell`/`PokeItemProvider` outside
`use_engine.rs`/`item_data.rs`.
**PROBLEM / nit:** ✅ **FIXED (with one documented divergence)** (commit `55c2ba87`,
test + docs only). Added `apply_effect`-**routed** parity tests covering **every**
status `status_cured_by` maps: `burn_heal`, `ice_heal` (Freeze), `awakening` (Sleep),
`parlyz_heal` (Paralysis), and `full_heal_cure_all` (Poison/Burn/Freeze/Sleep/
Paralysis) — each drives the engine `use_item`/`apply_effect` driver and compares
against legacy `use_status_cure` (expected outcomes computed from the legacy path,
nothing hardcoded; consume flag cross-checked against actual inventory removal). Edge
cases through both paths: wrong-cure→NoEffect, already-Healthy→NoEffect, None
target→Failed, full-heal-consumes-only-on-real-cure. **Documented divergence (not
asserted equal):** `cure_item_on_fainted_target` — legacy `use_status_cure` guards on
`hp==0`→NoEffect, while engine `apply_effect` decides curability via `status_cured_by`
(probes a full-HP scratch Pokémon, lacking the faint guard) → cures regardless. Pinned
in a test so a future call-site swap is aware (per the fall-back rule). Honesty docs:
`shop_inventory` now carries a comment that stock wiring is staged (returns empty; only
price/can_sell delegated), and the module docs state non-cure effects
(HP/PP/vitamin/Rare Candy) **intentionally** return NoEffect through `apply_effect` and
stay on the Pokémon path — flagged as a swap hazard, not a no-op claim. ⏳
**STILL-STAGED:** routing non-cure effects through `apply_effect` (needs Pokémon-only
data). Minor agnosticism nit (default `sell_price = buy/2`) **not addressed** —
overridable, documented.
**Verdict: FIXED (cure parity deepened + honesty docs; fainted divergence documented;
non-cure routing still staged).**

---

## Consolidated STAGED follow-ups (with deferral reason)

1. **P0d encounter call-site swap** — route `update.rs:1968-2010` through
   `EncounterEngine::on_step`. *Deferred because:* legacy draws both RNG bytes
   unconditionally; `on_step` gates first (zero draws on ineligible tiles) →
   swapping changes RNG draw count and desyncs the stream. Must reconcile draw
   semantics (draw-both-before-gate, or accept a re-baseline) **and** fix the
   hardcoded `party_lead_level: 5` (`update.rs:1992`) at the same time.
2. **P0a `Pokemon`-struct re-point** — point production leveling at the engine
   `Monster` model. *Deferred because:* the engine's `gain_exp`/`recalc_stats` HP
   policy diverges from Gen-1 `process_level_up` (no HP-delta growth, no
   move-learning). Either make engine HP recalc provider-configurable to match
   `hp += new_max_hp - old_max_hp` (and learn moves), or keep `process_level_up`
   authoritative and use the engine only for storage/stat-calc.
3. **P0e item-use call-site swap** — route the field/battle use path through
   `use_item`. *Deferred because:* `apply_effect` only implements status cure;
   HP/PP/vitamin/Rare-Candy return `NoEffect`, so a naive swap silently breaks those
   items. Decide whether non-cure effects flow through `use_item` first.
4. **P0c AI call-site swap** — route `pick_enemy_move` (`battle/mod.rs:690-718`)
   through `TrainerAiProvider`/`BattleAi::choose`. *Deferred because:* exact RNG
   parity is only proven for the flat-score/tie case; non-uniform Layer1/2/3 scoring
   is unverified through the engine path.
5. **P0b battle-loop call-site swap** — implement the 4 new `BattleProvider` hooks
   in `impl_traits.rs:1065` and drive the turn loop via `BattleDriver::execute_turn`.
   *Deferred because:* no pokered driver wiring exists and no parity test proves
   equivalence to the real Gen-1 loop (tie-break + draw-order risk).

---

## Problems / nits surfaced by the reviews (fix before the relevant swap)

> **Status after the 2026-06-02 fix pass** — see also the Update section at the top.

- **P0b: no parity test exists** — ⏳ **STILL-STAGED** (the full differential battle-loop
  parity test). The related event-fidelity sub-nit (`critical: false` hardcoded) is
  ✅ **FIXED** in `794af386` via a defaulted `roll_critical` hook surfaced into the
  Damage event + 2 driver tests. The headline differential test driving a real pokered
  battle through `BattleDriver::execute_turn` vs `engine.rs`/`turn_order.rs` (reconcile
  engine `OrderKey` tie-break `mod.rs:281` vs `random_byte < 128`, `turn_order.rs:40`)
  was **not** added — pokered's live loop does not route through the driver.
- **P0a: overclaiming doc comment** — ✅ **FIXED** in `5210d6e1`. Doc reworded; the
  near-tautological `gain_exp_via_engine_levels_up` was **replaced** with
  `gain_exp_matches_process_level_up`, driving a **damaged, leveling** Bulbasaur
  through both paths asserting equal `hp`/`max_hp`/stats/move slots/PP/learned moves.
  Engine level-up is now a Gen-1 drop-in via two defaulted `ExpProvider` hooks.
- **P0c: weak parity coverage** — ✅ **FIXED** in `f168e633`. Parity test with a
  **non-empty Layer3** (2-move super-effective winner subset) asserts chosen move +
  `rng.consumed()==1` match the real `choose_moves`+`pick_move`. No engine change
  needed (flat-score provider already ties over exactly the `choose_moves` winner set).
- **P0d: pre-existing repel bug** — ✅ **FIXED** in `2dc9b735`. Real lead level threaded
  (new `OverworldScreen.party_lead_level`, synced in `pokered-app/game.rs` at all four
  party-sync sites; `update.rs` consumes it). Parity harness extended to **water + cave**
  (6 new tests). ⏳ **Fishing parity STILL-STAGED** — not reachable through this harness
  (separate rod-based path); cemetery is a grass table (covered by classification).
- **P0e: shallow `apply_effect` parity** — ✅ **FIXED (with documented divergence)** in
  `55c2ba87`. `apply_effect`-routed parity for every cured status + Full Heal cure-all,
  plus no-target / already-cured edge cases; **fainted-target** is **documented as a
  genuine divergence** (legacy `hp==0` guard vs generic probe) rather than asserted
  equal. Honesty docs added (`shop_inventory` returns empty / stock staged; non-cure
  effects return NoEffect by design). ⏳ Non-cure-effect routing **STILL-STAGED**
  (needs Pokémon-only data).
- **Minor agnosticism leaks (documented, low priority — NOT addressed in this pass):**
  Gen-1-shaped `MonsterStatus` enum (P0a), `u8`-only encounter level type (P0d), default
  `sell_price = buy/2` Gen-1 mart rate (P0e). None violate the architecture rule
  (no Pokémon identifiers; overridable/lossy-mappable), but worth tracking if a
  second game is onboarded.

---

## Bottom line

The additive engine layer for all five P0 systems is correctly **agnostic,
rand-free, properly additive (no existing-trait breakage), and green**, and the
**staging claims are honest and verifiable** — production is genuinely untouched, so
the ~1800 Gen-1 tests stay green by construction. The migration is **substantially
done at the engine layer and substantially staged at the call sites.** The single
most urgent gap is **P0b's missing parity test** (equivalence asserted, never
demonstrated); the highest-risk swaps are **P0d** (RNG-draw-count desync) and
**P0e** (`apply_effect` only covers status cure). None of these block the current
green state — they are the work that must precede each production swap.

**Post-fix-pass (2026-06-02):** the per-review **nits** are now closed — P0a/P0c/P0d are
fully fixed; P0b's event-fidelity crit gap and P0e's cure-parity depth + honesty docs
are fixed (P0e's fainted-target divergence documented, not asserted). The remaining work
is the **production call-site swaps** (all five) plus P0b's end-to-end battle-loop
differential parity and P0e's non-cure-effect routing — these stay **STAGED** and are
intentionally not done in a nit-closing pass. Engine layer remains agnostic, rand-free,
green (292 / 1821).
