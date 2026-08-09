# P0 Engine-Gap Migration Blueprint (dependency-ordered)

**Role of this doc:** the single, authoritative, *implementation-ordered* plan for
lifting all P0 systems out of `examples/pokered/crates/pokered-core` into the
game-agnostic `dotzuki-engine`, incorporating the corrections raised by the
adversarial critiques. Companion docs: `00-SUMMARY.md`, `01-engine-inventory.md`,
`02-pokered-inventory.md`.

## Non-negotiable architecture rules (carried from CLAUDE.md)

1. **`dotzuki-engine` stays 100% game-agnostic.** No Pokémon concrete types ever
   land in the engine. Everything game-specific is an *associated type* on a
   provider trait, exactly like the existing `GameData` master trait and
   `BattleProvider`/`ItemProvider`/`ShopProvider` pattern (see
   `crates/dotzuki-engine/src/lib.rs` and `src/battle/mod.rs`).
2. **`pokered-core` is pure logic, no I/O.** Lifted drivers must remain
   deterministic and unit-testable; RNG enters only through an injected trait.
3. **Gen-1 quirks are injected, never baked.** The engine driver must give the
   game hooks to reproduce Focus Energy *lowering* crit, the 1/256 "miss",
   per-stat 0–255 wrap, the badge-boost/stat-stage recompute order, Hyper Beam
   recharge, partial-trap RNG, the "sleep-counter decrements before the move"
   ordering, AI tie-break bugs, etc. The engine supplies *sequencing*; the
   provider supplies *numbers and rule decisions*.
4. **~2,800 pokered-core tests must stay green at every step.** The migration is
   a sequence of "extract behind a trait, then re-implement pokered-core on top
   of the trait" refactors. No test is rewritten to change an expected outcome;
   tests may only move with the code they cover.

### Critique corrections folded in (read before building)

- **C1 (party-model first, not battle-first).** The original per-system design
  ordered battle-driver first. The critiques are correct: the battle driver
  borrows a party/monster model (HP, stats, status, fainting, EXP payout target)
  it does not yet have. **Party model ships first.**
- **C2 (no RNG baked into the driver).** Earlier battle-driver draft called
  `rand` internally. Corrected: all randomness flows through a `BattleRng`
  provider object passed into the driver; the engine never links `rand`.
- **C3 (damage formula stays in the game).** A draft proposed a generic Gen-1
  damage helper in the engine. Rejected — it would bake Gen-1 numerics. The
  engine driver only *calls* `BattleProvider::calculate_damage`; the formula and
  every quirk stay in `pokered-core`.
- **C4 (turn order is provider-decided, engine-sequenced).** Priority/speed
  tie-break (incl. the Gen-1 speed-tie coin flip and quick-claw-less ordering)
  is computed by a provider hook returning an ordering key; the engine only
  stable-sorts and drives. This keeps the 1/256-style quirks game-side.
- **C5 (encounter roll is a provider, step-hook is engine).** The wild-encounter
  draft put rate tables in the engine. Corrected: tables + the Gen-1 encounter
  rate / repel / "first step on tall grass" quirks live in a game provider; the
  engine owns only the *step → maybe-encounter → battle-handoff* state machine.
- **C6 (item effects are an opaque effect-id dispatch).** The engine must not
  enumerate Potion/Antidote/Rare Candy. It dispatches an associated
  `ItemEffectId` to a provider callback; all heal/cure/evo/stat numbers stay in
  the game. This supersedes any draft that added concrete effect variants to the
  engine `MoveEffect`/item enums.
- **C7 (AI is a scorer, not a policy).** Engine owns the *AI loop scaffold*
  (enumerate legal actions → ask provider to score → pick by score with an
  injected tie-break RNG). The Gen-1 AI scoring tables, the "discourage/encourage"
  +/- nudges, and the known AI bugs live entirely in the provider.
- **C8 (`unsafe mem::zeroed` and `game_api.rs` stub are out of scope for P0)** —
  noted only so nobody bundles them in; they are P2 cleanups.

---

## System 1 — Party / monster model  *(build FIRST — everything else borrows it)*

### Rationale
The battle driver, EXP payout, wild-encounter handoff, and item effects all need
a *creature instance* with HP/level/stats/status/moves/PP and a party container.
Today the engine only has bare `Species`/`Move`/`Item` IDs (`GameData`) and a
`BattlerState` snapshot inside `battle/mod.rs`. We promote a persistent monster
model into its own engine module so all P0 systems share one type.

### New / changed engine files
- **NEW** `crates/dotzuki-engine/src/party/mod.rs` — module root, re-exports.
- **NEW** `crates/dotzuki-engine/src/party/monster.rs` — `MonsterInstance`, `MonsterProvider`.
- **NEW** `crates/dotzuki-engine/src/party/party.rs` — `Party<P>` container.
- **NEW** `crates/dotzuki-engine/src/party/experience.rs` — generic EXP/level driver.
- **NEW** `crates/dotzuki-engine/src/party/evolution.rs` — generic evolution driver.
- **CHANGED** `crates/dotzuki-engine/src/lib.rs` — `pub mod party;` + re-exports.
- **CHANGED** `crates/dotzuki-engine/src/battle/mod.rs` — `BattlerState<P>` gains
  `From<&MonsterInstance<P>>` so battle borrows the persistent model (no schema
  fork). This is additive; existing `BattlerState` fields are unchanged.

### Public Rust signatures to add

```rust
// party/monster.rs
pub trait MonsterProvider {
    type Species: Copy + Eq + std::hash::Hash + std::fmt::Debug;
    type Move:    Copy + Eq + std::hash::Hash + std::fmt::Debug;
    type Stat:    crate::battle::StatKey;
    type Status:  Copy + Eq + std::fmt::Debug;
    type Nature:  Copy + Eq + std::fmt::Debug;   // unit-like type for games w/o natures

    /// Base stat value for a species/stat. Game owns the table.
    fn base_stat(&self, species: Self::Species, stat: Self::Stat) -> u16;
    /// Recompute *all* stats from level/base/IV-DV/EV-StatExp. Game owns the
    /// formula AND the Gen-1 0..=255 wrap + badge boosts (badge boosts applied
    /// in battle, not here).
    fn calc_stats(&self, m: &MonsterInstance<Self>) -> crate::battle::EnumMap<Self::Stat, u16>
        where Self: Sized;
    /// EXP needed to *reach* `level` for this species' growth group.
    fn exp_for_level(&self, species: Self::Species, level: u8) -> u32;
    /// Growth group lookup so the engine never hardcodes the 6 curves.
    fn max_level(&self) -> u8 { 100 }
    /// Default moveset on capture/creation at a level (learnset). Game owns it.
    fn default_moves(&self, species: Self::Species, level: u8) -> Vec<Self::Move>;
    /// Moves learned exactly at `level` (for level-up learn prompts).
    fn moves_learned_at(&self, species: Self::Species, level: u8) -> Vec<Self::Move>;
    fn move_max_pp(&self, mv: Self::Move) -> u8;
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct MonsterInstance<P: MonsterProvider + ?Sized> {
    pub species: P::Species,
    pub level: u8,
    pub exp: u32,
    pub current_hp: u16,
    pub status: Option<P::Status>,
    pub moves: Vec<P::Move>,
    pub move_pp: Vec<u8>,
    pub stats: crate::battle::EnumMap<P::Stat, u16>,
    /// Opaque, game-defined individual values / DVs (Gen-1 = 0..=15 packed).
    pub ivs: crate::battle::EnumMap<P::Stat, u16>,
    /// Opaque, game-defined effort values / Stat-Exp (Gen-1 = 0..=65535).
    pub evs: crate::battle::EnumMap<P::Stat, u16>,
    pub nature: P::Nature,
    pub original_trainer: u32,
    pub nickname: Option<String>,
}

impl<P: MonsterProvider> MonsterInstance<P> {
    /// Create at a level via the provider (stats + default moves + full HP).
    pub fn new(provider: &P, species: P::Species, level: u8,
               ivs: crate::battle::EnumMap<P::Stat, u16>,
               nature: P::Nature, ot: u32) -> Self;
    pub fn is_fainted(&self) -> bool { self.current_hp == 0 }
    pub fn recompute_stats(&mut self, provider: &P); // calls provider.calc_stats
}

// party/party.rs
pub const MAX_PARTY: usize = 6;
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Party<P: MonsterProvider + ?Sized> { members: Vec<MonsterInstance<P>> }
impl<P: MonsterProvider> Party<P> {
    pub fn new() -> Self;
    pub fn len(&self) -> usize;
    pub fn is_full(&self) -> bool;          // len == MAX_PARTY
    pub fn add(&mut self, m: MonsterInstance<P>) -> Result<usize, PartyFull>;
    pub fn get(&self, i: usize) -> Option<&MonsterInstance<P>>;
    pub fn get_mut(&mut self, i: usize) -> Option<&mut MonsterInstance<P>>;
    pub fn swap(&mut self, a: usize, b: usize);
    pub fn first_able(&self) -> Option<usize>;   // first non-fainted (lead select)
    pub fn all_fainted(&self) -> bool;           // -> battle loss / whiteout
    pub fn iter(&self) -> impl Iterator<Item = &MonsterInstance<P>>;
}

// party/experience.rs  — engine sequences, provider supplies numbers/quirks
pub trait ExpProvider: MonsterProvider {
    /// EXP yielded by a fainted opponent to one participant. Game owns the
    /// Gen-1 formula (base_exp * level / 7, /participants, trainer 1.5x, etc.).
    fn exp_yield(&self, fainted: &MonsterInstance<Self>, gainer: &MonsterInstance<Self>,
                 participants: u8, is_trainer_battle: bool) -> u32 where Self: Sized;
}
pub struct LevelUp<P: MonsterProvider> {
    pub new_level: u8,
    pub old_stats: crate::battle::EnumMap<P::Stat, u16>,
    pub new_stats: crate::battle::EnumMap<P::Stat, u16>,
    pub learned: Vec<P::Move>,        // moves_learned_at(new_level)
}
/// Add EXP, applying as many level-ups as warranted (multi-level). Returns one
/// LevelUp per level crossed so the UI can animate each, in order. Stat recompute
/// is delegated to the provider (preserves Gen-1 recompute-on-level-up quirk).
pub fn gain_exp<P: ExpProvider>(provider: &P, mon: &mut MonsterInstance<P>, amount: u32)
    -> Vec<LevelUp<P>>;

// party/evolution.rs — engine sequences, provider decides
pub trait EvolutionProvider: MonsterProvider {
    type EvoTrigger: Copy + Eq + std::fmt::Debug; // e.g. LevelUp/Stone/Trade (game enum)
    /// Does this monster evolve right now under `trigger`? Returns target species.
    fn evolves_to(&self, mon: &MonsterInstance<Self>, trigger: Self::EvoTrigger)
        -> Option<Self::Species> where Self: Sized;
}
/// Apply an evolution: swap species, recompute stats (provider), keep HP ratio /
/// learn evo-level moves per provider rules. Engine never names a species.
pub fn try_evolve<P: EvolutionProvider>(provider: &P, mon: &mut MonsterInstance<P>,
    trigger: P::EvoTrigger) -> Option<P::Species>;
```

### pokered-core adaptation
- `pokered-core/src/pokemon/mod.rs::Pokemon` becomes a thin wrapper around (or a
  type alias for) `MonsterInstance<PokeProvider>`; its existing public methods
  delegate. The Gen-1 stat formula, DV packing, Stat-Exp, the 6 growth curves,
  and the `exp_for_level` table stay in pokered-core behind `MonsterProvider`.
- `pokered-core/src/battle/experience.rs` keeps the **exact** Gen-1 EXP formula
  inside `ExpProvider::exp_yield`; the multi-level loop, learn-move prompts and
  stat recompute call into `party::experience::gain_exp`. The "EXP All split" and
  "participant count" quirks remain numbers the provider returns.
- Evolution tables (level/stone/trade, plus the cancel-evolution input) stay in
  pokered-core behind `EvolutionProvider`.

### Smallest safe incremental steps (each: `cargo build` + `cargo test` green)
1. Add empty `party` module + `MonsterProvider`/`MonsterInstance`/`Party` with
   `From<&MonsterInstance<P>> for BattlerState<P>`. No pokered changes yet. Build.
2. Implement `PokeProvider: MonsterProvider` in pokered-core delegating to the
   *existing* Gen-1 functions. Add an internal round-trip test
   (`Pokemon -> MonsterInstance -> Pokemon` is identity). Build + test.
3. Re-point `Pokemon` stat/move/PP storage to `MonsterInstance` fields (type alias
   or newtype), keeping every public method signature. Run full suite.
4. Move EXP/level-up into `gain_exp` + `ExpProvider`; pokered's `experience.rs`
   tests now exercise the engine path. Run full suite.
5. Move evolution into `try_evolve` + `EvolutionProvider`. Run full suite.

---

## System 2 — Battle turn-execution driver  *(build SECOND)*

### Rationale
The engine has `BattleProvider`/`BattleState`/`BattlerState`/`MoveEffect`/
`EffectResult`/`DamageResult`/`TypeChart`/`EffectHandler`/`BattleAction` (real,
~1.1k LOC, tested) but **no turn loop, priority queue, RNG sequencing, or
status-tick scheduler** (`01-engine-inventory.md` §1.9). pokered's
`battle/mod.rs` drives turns. We lift the *driver* generically; the formula,
effects, and every quirk stay in the provider.

### New / changed engine files
- **NEW** `crates/dotzuki-engine/src/battle/driver.rs` — the turn engine.
- **NEW** `crates/dotzuki-engine/src/battle/rng.rs` — `BattleRng` trait (no `rand`).
- **CHANGED** `crates/dotzuki-engine/src/battle/mod.rs` — `pub mod driver; pub mod rng;`
  and extend `BattleProvider` with sequencing hooks (additive; defaults provided
  so existing impls/tests compile unchanged).

### Public Rust signatures to add

```rust
// battle/rng.rs  — C2: engine never links `rand`
pub trait BattleRng {
    /// Uniform integer in [0, bound). Game decides the generator => same RNG
    /// stream as the original, enabling the 1/256 miss, shake checks, etc.
    fn gen_range(&mut self, bound: u32) -> u32;
    /// Coin flip with numerator/denominator (e.g. crit, speed-tie, 255/256 hit).
    fn chance(&mut self, num: u32, den: u32) -> bool { self.gen_range(den) < num }
}

// battle/mod.rs — additive hooks on the EXISTING BattleProvider trait.
// (All defaulted so current mock-RPS tests and pokered keep compiling.)
pub trait BattleProvider {
    // ... existing assoc types Monster/Move/Ability/Status/Stat/Species/Type/Item
    // ... existing: calculate_damage, select_move, apply_move_effect,
    //               create_monster, check_faint

    /// C4: provider returns a *sort key* per battler for this turn. Engine
    /// stable-sorts ascending. Game encodes priority bracket, speed, the Gen-1
    /// speed-tie coin flip (via the passed rng), paralysis speed-cut, etc.
    fn turn_order_key(&self, st: &BattleState<Self>, side: BattlerRef,
                      action: &BattleAction<Self>, rng: &mut dyn BattleRng) -> OrderKey
        where Self: Sized { OrderKey::default() }

    /// Pre-move gate: can this battler act? Returns Acts / Prevented(reason).
    /// Game owns sleep-counter-decrement-before-move, freeze, full-para roll,
    /// flinch, recharge (Hyper Beam), confusion self-hit, partial-trap, etc.
    fn before_move(&self, st: &mut BattleState<Self>, who: BattlerRef,
                   action: &BattleAction<Self>, rng: &mut dyn BattleRng) -> MoveGate<Self>
        where Self: Sized { MoveGate::Acts }

    /// End-of-turn residual hook: poison/burn tick, leech seed, wrap damage,
    /// weather, etc. Returns events for the UI. Game owns ordering + numbers.
    fn end_of_turn(&self, st: &mut BattleState<Self>, rng: &mut dyn BattleRng)
        -> Vec<EffectResult> where Self: Sized { Vec::new() }

    /// Accuracy check for a damaging/most moves (incl. the 1/256 miss quirk).
    fn accuracy_check(&self, st: &BattleState<Self>, user: BattlerRef,
                      target: BattlerRef, mv: Self::Move, rng: &mut dyn BattleRng)
        -> bool where Self: Sized { true }
}

#[derive(Clone, Copy, Debug)]
pub struct BattlerRef { pub side: u8, pub slot: u8 } // 1v1 Gen-1 => slot 0
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord)]
pub struct OrderKey(pub i32, pub i32, pub u32); // (priority desc, speed desc, tiebreak)
pub enum MoveGate<P: BattleProvider> {
    Acts,
    Prevented(EffectResult),        // e.g. Asleep/Frozen/Flinched/Recharging
    ForcedAction(BattleAction<P>),  // e.g. confusion self-hit, thrash continuation
}

// battle/driver.rs — the lifted loop. Pure: state in, events out, rng injected.
pub enum TurnEvent { /* MoveUsed/Missed/Damage/Faint/StatChange/Status/Message... */ }
pub struct TurnOutcome { pub events: Vec<TurnEvent>, pub battle_over: Option<BattleEnd> }
pub enum BattleEnd { PlayerWin, PlayerLoss, Fled, Caught }

pub struct BattleDriver;
impl BattleDriver {
    /// Execute exactly one full turn given each side's chosen action.
    /// Sequence (engine-owned, quirks provider-owned):
    ///   1. turn_order_key for each actor -> stable sort.
    ///   2. for each actor in order: before_move gate -> accuracy_check ->
    ///      calculate_damage / apply_move_effect (provider) -> faint check.
    ///   3. end_of_turn residuals.
    ///   4. fold into TurnOutcome + detect BattleEnd via Party::all_fainted.
    pub fn execute_turn<P: BattleProvider>(
        provider: &P,
        state: &mut BattleState<P>,
        actions: [BattleAction<P>; 2],
        rng: &mut dyn BattleRng,
    ) -> TurnOutcome;

    /// Switch / forced-switch helper (on faint). Pulls the next able party
    /// member; the *choice* of replacement is the caller's (UI or AI).
    pub fn apply_switch<P: BattleProvider>(state: &mut BattleState<P>,
        side: u8, to_slot: usize);
}
```

### pokered-core adaptation
- `pokered-core/src/battle/mod.rs` stops owning the loop; it calls
  `BattleDriver::execute_turn` once per turn and maps `TurnEvent`s to its
  existing UI/animation state machine in `battle/ui_state/`.
- pokered implements the new defaulted hooks with its **existing** code:
  `turn_order_key` ← current speed/priority logic incl. the speed-tie coin flip;
  `before_move` ← current sleep/freeze/para/flinch/recharge/confusion logic;
  `end_of_turn` ← current poison/burn/leech/wrap residual code;
  `accuracy_check` ← current hit formula incl. **1/256 miss**.
- `calculate_damage` (Gen-1 formula: crit, STAB, type, the crit-uses-base-speed
  table, Focus Energy lowering crit) is unchanged — the driver only *calls* it
  (C3). A `PokeRng` newtype wraps pokered's existing RNG to impl `BattleRng` (C2).
- Catch/run: pokered keeps `catch.rs`/run logic; it returns `BattleEnd::Caught/
  Fled` through the action it submits (catch is a `BattleAction::UseItem`-style
  action whose effect resolution lives in the provider).

### Smallest safe incremental steps
1. Add `battle/rng.rs` + the defaulted hooks on `BattleProvider`. Build (no
   behavior change; defaults make it a no-op). Run full suite.
2. Add `battle/driver.rs` with `execute_turn` but **do not** call it from pokered
   yet. Add engine-side unit tests using the existing mock-RPS provider. Build.
3. Implement the four hooks in pokered's provider by *delegating to existing
   functions* (move the bodies, keep them callable). Run full suite.
4. Flip `pokered-core/battle/mod.rs` to call `BattleDriver::execute_turn` for one
   action type (e.g. Fight) behind a feature flag / branch; diff event stream
   against the old path in tests. Run full suite.
5. Migrate remaining action types (Switch/Item/Run/Catch) one by one, each time
   running the full ~2,800-test suite. Delete the dead old loop last.

---

## System 3 — Battle AI  *(build THIRD — needs the driver + party)*

### Rationale
Engine has a bare `BattleAI` trait; the real scorer lives in
`pokered-core/battle/trainer_ai/`. C7: lift the *AI loop scaffold* only; keep
Gen-1 scoring tables and known AI bugs in the provider.

### New / changed engine files
- **NEW** `crates/dotzuki-engine/src/battle/ai.rs` — AI driver scaffold.
- **CHANGED** `crates/dotzuki-engine/src/battle/mod.rs` — `pub mod ai;`; extend the
  existing `BattleAI` trait with a scorer method (additive, defaulted).

### Public Rust signatures to add

```rust
// battle/ai.rs
/// Engine-owned AI scaffold: enumerate legal actions, ask the game to score each,
/// pick the best with an injected tie-break. NO Pokémon logic here.
pub trait BattleAiProvider: BattleProvider {
    /// Score a candidate action; higher = more preferred. Game owns the Gen-1
    /// score table, the discourage/encourage +/- nudges, and the AI bugs
    /// (e.g. ignoring type immunities in some routines). Mutating `rng` allows
    /// the original's tie randomization.
    fn score_action(&self, st: &BattleState<Self>, me: BattlerRef,
                    action: &BattleAction<Self>, rng: &mut dyn BattleRng) -> i32
        where Self: Sized;
    /// Legal actions for the AI side this turn (fight options + legal switches).
    fn legal_actions(&self, st: &BattleState<Self>, me: BattlerRef)
        -> Vec<BattleAction<Self>> where Self: Sized;
}
pub struct BattleAi;
impl BattleAi {
    /// Choose the AI's action for this turn. Ties broken via rng (matches the
    /// original's "pick among equal-best" behavior, including its bias bugs).
    pub fn choose<P: BattleAiProvider>(provider: &P, st: &BattleState<P>,
        me: BattlerRef, rng: &mut dyn BattleRng) -> BattleAction<P>;
}
```

### pokered-core adaptation
- `pokered-core/battle/trainer_ai/` implements `score_action` + `legal_actions`
  with its **existing** scoring tables and quirk-preserving nudges. The selection
  loop moves to `BattleAi::choose`. The AI's "switch decision" thresholds stay
  game-side.

### Smallest safe incremental steps
1. Add `battle/ai.rs` + defaulted scorer methods. Build (no-op). Run suite.
2. Implement `score_action`/`legal_actions` in pokered by delegating to existing
   AI functions. Run suite.
3. Replace pokered's AI selection call site with `BattleAi::choose`. Diff chosen
   actions in AI tests against old path. Run suite. Delete dead selection code.

---

## System 4 — Wild encounter + battle handoff  *(build FOURTH)*

### Rationale
Connect overworld → battle generically. C5: the engine owns the step-driven
state machine; the encounter rate tables and Gen-1 encounter quirks live in a
provider.

### New / changed engine files
- **NEW** `crates/dotzuki-engine/src/overworld/encounter.rs` — encounter state machine.
- **CHANGED** `crates/dotzuki-engine/src/overworld/mod.rs` — `pub mod encounter;`.
- (Consumes `party::Party`, `battle::BattleState`, and `BattleRng` — no new deps.)

### Public Rust signatures to add

```rust
// overworld/encounter.rs
pub trait EncounterProvider {
    type Species: Copy + Eq + std::fmt::Debug;
    /// Roll a wild encounter for the tile the player just stepped onto.
    /// Returns the chosen (species, level) or None. Game owns rate tables,
    /// grass/water/fishing slots, repel, the "first tall-grass step" quirk,
    /// and the encounter-rate-by-tile lookups.
    fn roll_encounter(&self, map_id: u32, x: i32, y: i32, mode: EncounterMode,
                      rng: &mut dyn crate::battle::rng::BattleRng)
        -> Option<(Self::Species, u8)>;
    /// Is the tile encounter-eligible at all (tall grass / water)? Cheap gate
    /// the engine checks before rolling.
    fn is_encounter_tile(&self, map_id: u32, x: i32, y: i32) -> bool;
}
#[derive(Clone, Copy, Debug)]
pub enum EncounterMode { Walking, Surfing, Fishing { rod_power: u8 } }
pub enum EncounterStep { None, Encounter { species_level: (u32, u8) } }
pub struct EncounterEngine;
impl EncounterEngine {
    /// Call once per completed player step. Engine checks eligibility then
    /// delegates the roll to the provider. Pure; rng injected.
    pub fn on_step<E: EncounterProvider>(provider: &E, map_id: u32, x: i32, y: i32,
        mode: EncounterMode, rng: &mut dyn crate::battle::rng::BattleRng)
        -> EncounterStep;
}
```

> **Handoff contract (resolves cross-system contradiction):** `on_step` returns
> *data only* (species+level). The engine does **not** construct a battle —
> avoiding a dependency from overworld onto a concrete battle setup. The game
> turns the result into a `MonsterInstance` via `MonsterProvider` and seeds
> `BattleState`, then runs `BattleDriver`. This keeps overworld and battle
> decoupled, matching the existing "step_bridge returns intent, game executes"
> pattern in the JS scripting bridge.

### pokered-core adaptation
- pokered's overworld encounter code becomes `EncounterProvider` (existing rate
  tables + `is_encounter_tile`). The per-step call site uses
  `EncounterEngine::on_step`; on `Encounter`, pokered builds the wild
  `MonsterInstance` (System 1) and starts the battle (System 2). The repel/first-
  step quirks stay in `roll_encounter`.

### Smallest safe incremental steps
1. Add `encounter.rs` with the trait + `on_step`. Build (unused). Run suite.
2. Implement `EncounterProvider` in pokered delegating to existing tables. Add a
   test that fixes the rng stream and asserts the same species/level as today.
3. Swap pokered's step hook to `EncounterEngine::on_step`. Run suite.

---

## System 5 — Item effects + bag/shop flow  *(build LAST of P0)*

### Rationale
Engine has `Inventory<I>`/`ItemProvider`/`ShopProvider` but **no effect
application or use-flow** (`01-engine-inventory.md` §1.9). C6: dispatch an opaque
`ItemEffectId` to provider callbacks; no concrete item effects in the engine.

### New / changed engine files
- **CHANGED** `crates/dotzuki-engine/src/items.rs` — add effect-dispatch driver +
  `UsageContext`; extend `ItemProvider` (additive, defaulted).
- **NEW** `crates/dotzuki-engine/src/items/effect.rs` *(split items.rs into a module
  dir, or add inline)* — `ItemEffectId`, `ItemUseResult`, `apply_item`.

### Public Rust signatures to add

```rust
// items (extended). Effects are OPAQUE ids dispatched to the game.
pub trait ItemProvider {
    type Item: Copy + Eq + std::hash::Hash + std::fmt::Debug;
    // ... existing: name/desc/price/can_use/use_on_monster/consume ...

    /// Where/whether an item may be used (field vs battle vs both).
    fn usable_in(&self, item: Self::Item) -> UsageContext { UsageContext::FieldAndBattle }

    /// Apply the item's effect to an optional target monster, in a context.
    /// The game owns ALL numbers: heal amounts, status cure, evo stones,
    /// Rare Candy = +1 level (via party::gain_exp to next level), repel steps,
    /// Poké Ball catch (returns CaughtInto/Failed), the Gen-1 item bugs.
    /// Engine only routes the call and reports consumption.
    fn apply_effect<M: crate::party::MonsterProvider>(
        &self, item: Self::Item, ctx: UsageContext,
        target: Option<&mut crate::party::MonsterInstance<M>>,
        rng: &mut dyn crate::battle::rng::BattleRng,
    ) -> ItemUseResult;
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UsageContext { FieldOnly, BattleOnly, FieldAndBattle, None }
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ItemUseResult {
    Applied { consume: bool, message_key: Option<String> },
    NoEffect,                 // e.g. Potion on full HP -> "It won't have any effect"
    Caught,                   // ball succeeded (battle ctx)
    Failed,
}
/// Engine driver: validate (can_use/usable_in) -> apply_effect -> consume from
/// the Inventory if the result says so. One place so field & battle share it.
pub fn use_item<I, M>(provider: &I, inv: &mut Inventory<I::Item>, item: I::Item,
    ctx: UsageContext, target: Option<&mut crate::party::MonsterInstance<M>>,
    rng: &mut dyn crate::battle::rng::BattleRng) -> ItemUseResult
where I: ItemProvider, M: crate::party::MonsterProvider;
```

### pokered-core adaptation
- pokered's `items/` effect code becomes `ItemProvider::apply_effect`, keyed by
  its own item enum. Healing/cure/evo-stone/Rare-Candy/repel numbers + the Gen-1
  item quirks stay there. Bag add/remove already uses engine `Inventory`; the
  field and battle "use item" call sites both route through `items::use_item`.
- Shop buy/sell keeps using `ShopProvider` (already in engine); no change needed
  for P0 beyond confirming the wallet/price calls compile against the driver.

### Smallest safe incremental steps
1. Add `UsageContext`/`ItemUseResult`/`apply_effect` (defaulted `NoEffect`) +
   `use_item`. Build (no-op). Run suite.
2. Implement `apply_effect`/`usable_in` in pokered delegating to existing item
   effect functions. Run suite.
3. Route pokered's field "use item" through `items::use_item`. Run suite.
4. Route pokered's battle "use item" through `items::use_item`. Run suite.
   Delete dead duplicate dispatch.

---

## Global build-order checklist (top → bottom)

> Each numbered item ends with: **`cargo build` (workspace) + `cargo test`
> (workspace, all ~2,800 tests) green** before starting the next. Work from
> `workspace/`. Commit per checkbox.

- [ ] **0. Baseline.** `cargo test` clean; record current pass count.
- [ ] **1. Party module skeleton.** Add `party/{mod,monster,party}.rs`,
      `MonsterProvider`, `MonsterInstance`, `Party`, `From<&MonsterInstance> for BattlerState`. lib.rs `pub mod party;`.
- [ ] **2. PokeProvider.** Implement `MonsterProvider` in pokered-core delegating
      to existing Gen-1 functions; round-trip identity test.
- [ ] **3. Pokemon-on-MonsterInstance.** Re-point `Pokemon` storage to
      `MonsterInstance`; keep all public methods.
- [ ] **4. EXP/level-up.** Add `party/experience.rs` (`ExpProvider`, `gain_exp`,
      `LevelUp`); pokered EXP tests run through it.
- [ ] **5. Evolution.** Add `party/evolution.rs`; pokered evo tests run through it.
- [ ] **6. Battle RNG + hooks.** Add `battle/rng.rs` (`BattleRng`) + defaulted
      `BattleProvider` hooks (`turn_order_key`/`before_move`/`end_of_turn`/`accuracy_check`).
- [ ] **7. Battle driver.** Add `battle/driver.rs` (`BattleDriver::execute_turn`,
      `apply_switch`, `TurnEvent`/`TurnOutcome`/`BattleEnd`); engine tests on mock-RPS.
- [ ] **8. Implement hooks in pokered** by delegating to existing turn code;
      add `PokeRng: BattleRng`.
- [ ] **9. Flip pokered to the driver** action-type by action-type
      (Fight → Switch → Item → Run → Catch); delete old loop last.
- [ ] **10. AI scaffold.** Add `battle/ai.rs` (`BattleAiProvider`, `BattleAi::choose`).
- [ ] **11. Implement AI hooks in pokered**; swap selection call site; delete dead AI selection.
- [ ] **12. Encounter engine.** Add `overworld/encounter.rs`
      (`EncounterProvider`, `EncounterEngine::on_step`).
- [ ] **13. Implement EncounterProvider in pokered**; swap step hook; rng-fixed
      parity test.
- [ ] **14. Item effects.** Extend `items.rs` (`UsageContext`, `ItemUseResult`,
      `apply_effect`, `use_item`).
- [ ] **15. Implement apply_effect in pokered**; route field then battle use-item
      call sites; delete dead dispatch.
- [ ] **16. Sweep.** Confirm no Pokémon concrete type appears in `dotzuki-engine`
      (`grep -ri "pokemon\|species name\|Potion\|Charizard"` over `crates/dotzuki-engine/src` returns nothing meaningful). Full suite green. Update `00-SUMMARY.md` status.

---

## Preserving Gen-1 quirks via providers (explicit register)

Every quirk below is produced by **pokered's provider impl**, never by the
engine driver:

| Quirk | Provider hook that owns it |
|---|---|
| Focus Energy *lowers* crit | `BattleProvider::calculate_damage` (crit calc) |
| 1/256 "always miss" | `BattleProvider::accuracy_check` |
| Per-stat 0..=255 wrap & badge boosts | `MonsterProvider::calc_stats` / battle stat read in provider |
| Speed-tie coin flip; paralysis speed cut | `BattleProvider::turn_order_key` |
| Sleep counter decrements before move; freeze never thaws; Hyper Beam recharge; confusion self-hit; partial-trap RNG; flinch | `BattleProvider::before_move` |
| Poison/burn/leech/wrap residual order & numbers | `BattleProvider::end_of_turn` |
| EXP formula, participant split, EXP-All, trainer 1.5× | `ExpProvider::exp_yield` |
| 6 growth curves & `exp_for_level` table | `MonsterProvider::exp_for_level` |
| Evolution triggers (level/stone/trade) + cancel | `EvolutionProvider::evolves_to` |
| AI score tables, encourage/discourage nudges, AI bugs | `BattleAiProvider::score_action` |
| Encounter rates, grass/water/fishing slots, repel, first-step quirk | `EncounterProvider::roll_encounter` |
| Item heal/cure/evo/Rare-Candy/repel numbers, ball shake checks, item bugs | `ItemProvider::apply_effect` |

## Keeping dotzuki-engine game-agnostic (guardrails)

- The engine adds **only**: containers (`MonsterInstance`, `Party`,
  `BattleState` extensions), **sequencers** (`BattleDriver`, `BattleAi`,
  `EncounterEngine`, `gain_exp`, `try_evolve`, `use_item`), and **trait hooks**.
  No species/move/item/effect *values* and no `rand` dependency.
- Every game concept is an **associated type** (`Species`/`Move`/`Stat`/`Status`/
  `Nature`/`EvoTrigger`/`Item`/`ItemEffectId`) on a provider — mirroring the
  existing `BattleProvider`/`ItemProvider` pattern.
- All new `BattleProvider` methods are **defaulted** so the existing mock-RPS
  tests and any external impl keep compiling — proving the engine is usable by a
  non-Pokémon game with the defaults.
- RNG is injected via `BattleRng`; the engine never decides randomness, so a game
  can reproduce *any* original RNG stream (or use a fresh one).
- **Out of scope for P0** (do not bundle): the `MenuSystem` `unsafe mem::zeroed`
  fix and the empty `game_api.rs` stub (P2 cleanups), and the Pokémon-ism leakage
  in `tile_meta`/`palette`/`icon`/`ScriptCommand` (tracked separately; not P0).
