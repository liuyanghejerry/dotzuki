//! # minimon — the cross-gen authoring proof (design 09 §6)
//!
//! A *tiny mock game* built **entirely on `dotzuki-engine`'s effect-stack** that
//! proves a developer can author a Gen-1-to-Gen-6-LIKE battle system with **no
//! engine edits** beyond the Phase-1 additive seams (the broadened [`Event`]
//! taxonomy, the four defaulted resolvers, [`EffectHost`], and the `effect!`
//! authoring macro). It depends on the game-agnostic engine **only** — zero
//! pokered/pokered-core/pokered-data, zero game-specific concrete type, no `rand`.
//!
//! It is NOT byte-parity with anything; per §6.1 its oracle is **hand-specified
//! expected `BattleState` outcomes** (the way Showdown unit-tests an ability).
//!
//! ## The 5 systems it authors (design §6.1)
//!
//! | System | Engine event(s) used | Resolver / host used |
//! |---|---|---|
//! | **phys/special split** | (none — provider `calculate_damage`, §5) | `P::Stat` 6-stat shape |
//! | **Intimidate** ability | `SwitchIn` → game fires `TryBoost` | `effect_for_ability` (battler) |
//! | **Clear Body** veto | `TryBoost` (returns `Fail`) | `effect_for_ability` (battler) |
//! | **Leftovers** item | `Residual` (ordered after status chip) | `effect_for_item` (battler) |
//! | **Sandstorm** weather | `FieldResidual` chip + `WeatherModifyStat` SpD boost | `field_effects` ([`EffectHost::Field`]) |
//!
//! ## Authoring contract (the borrow proof, design §2.3)
//!
//! Every handler is a **zero-capture `fn`** taking `&mut BattleCtx` — never a
//! borrowed battler/effect ref, never the provider. Re-entrant dispatch (e.g.
//! Intimidate's `SwitchIn` handler wanting to fire `TryBoost`, which Clear Body
//! must be able to veto) is owned by the **game's driver helpers** in this crate
//! (they hold `&P`, build an owned snapshot via [`collect_handlers`], then fold
//! via [`run_event`]/[`run_event_checked`]). No `RefCell`, no `Rc`, no new
//! `unsafe`. This mirrors exactly how the engine's own `StackDriver` re-enters
//! dispatch, and is the §4/§6.2 "Authoring" axis the proof must satisfy.

use dotzuki_engine::battle::rng::ScriptedRng;
use dotzuki_engine::battle::stack::{
    collect_handlers, run_event, run_event_checked, BattleCtx, Effect, EffectId, EffectProvider,
    EffectState, EffectType, Event, EventHook, HandlerResult, MoveContext, RelayVar,
};
use dotzuki_engine::battle::{
    BattleProvider, BattleState, BattlerRef, BattlerState, DamageResult, EffectResult, EnumMap,
    MoveEffect,
};
use dotzuki_engine::effect;

// ─────────────────────────────────────────────────────────────────────────────
// 1. The game's data model — a 6-stat Gen-4 shape (proves the split is invisible
//    to the engine, design §5), plus minimal id enums for type/status/ability/
//    item, and a `Species` struct that carries a battler's ability + item + type
//    (BattlerState has no ability/item field, so — like the engine's own mock
//    game — the resolvers read identity off `species`).
// ─────────────────────────────────────────────────────────────────────────────

/// The 6-stat Gen-4 shape (design §5/§6.1). A Gen-1 game would define
/// `{Hp,Atk,Def,Spe,Spc}`; choosing the *split* shape here is the whole point —
/// the engine only ever indexes `EnumMap<P::Stat>` by an opaque key, so a
/// physical move reading `Atk/Def` vs a special move reading `SpA/SpD` is a pure
/// game decision in [`MinimonProvider::calculate_damage`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stat {
    /// Hit points (not read by the damage formula; carried for completeness).
    Hp,
    /// Physical attack — read by **physical** moves.
    Atk,
    /// Physical defense — read by **physical** moves.
    Def,
    /// Special attack — read by **special** moves.
    SpA,
    /// Special defense — read by **special** moves (Sandstorm boosts this for Rock).
    SpD,
    /// Speed.
    Spe,
}

/// Elemental type set. `Normal`/`Rock` drive the Sandstorm proofs; the five
/// 金木水火土 (Metal/Wood/Water/Fire/Earth) elements drive the type-chart proof
/// (doc 12). The engine never reads any of these — only minimon's
/// `type_chart_mult` and `defender_types` map them to opaque chart indices.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MType {
    /// Takes Sandstorm chip damage.
    Normal,
    /// Immune to Sandstorm chip; gains the Sandstorm SpD boost.
    Rock,
    /// 金 — conquers Wood, conquered by Fire.
    Metal,
    /// 木 — conquers Earth, conquered by Metal.
    Wood,
    /// 水 — conquers Fire, conquered by Earth; cannot damage Wood (immune edge).
    Water,
    /// 火 — conquers Metal, conquered by Water.
    Fire,
    /// 土 — conquers Water, conquered by Wood.
    Earth,
}

impl MType {
    /// The opaque chart index for this element (doc 12 §3.2: the engine sees only
    /// integers). `Normal`/`Rock` map past the 5-element 金木水火土 wheel so they
    /// are always neutral in the chart (never an authored edge).
    pub const fn chart_index(self) -> usize {
        match self {
            MType::Metal => 0,
            MType::Wood => 1,
            MType::Water => 2,
            MType::Fire => 3,
            MType::Earth => 4,
            MType::Normal => 5,
            MType::Rock => 6,
        }
    }
}

/// The 金木水火土 相克 (overcoming-cycle) chart as integer rationals
/// `(atk_index, def_index, num, den)` (doc 12 §2). Omitted pairs default to
/// `(1, 1)` = neutral. No float ever touches the stack path.
///
/// 克 edges (2×): 金克木, 木克土, 土克水, 水克火, 火克金.
/// reverse edges (1/2×): the defender overcomes the attacker.
/// one immunity (0×): 水→木 (water cannot damage wood — the worked no-effect case).
pub const TYPE_CHART: &[(usize, usize, u32, u32)] = &[
    // ── super-effective (2×) — the 克 edges ──────────────────────────────
    (0, 1, 2, 1), // 金克木  Metal → Wood
    (1, 4, 2, 1), // 木克土  Wood  → Earth
    (4, 2, 2, 1), // 土克水  Earth → Water
    (2, 3, 2, 1), // 水克火  Water → Fire
    (3, 0, 2, 1), // 火克金  Fire  → Metal
    // ── resisted (1/2×) — the reverse edges ──────────────────────────────
    (1, 0, 1, 2), // Wood  → Metal
    (4, 1, 1, 2), // Earth → Wood
    (2, 4, 1, 2), // Water → Earth
    (3, 2, 1, 2), // Fire  → Water
    (0, 3, 1, 2), // Metal → Fire
    // ── immunity (0×) — the one demonstrative no-effect pair ──────────────
    (2, 1, 0, 1), // 水→木  Water → Wood
];

/// Fold the chart product over all `defender_indices` into a SINGLE rational
/// `(num, den)` (doc 12 §5.3: one pre-combined rational ⇒ exactly one `scale`,
/// avoiding per-step truncation). Omitted pairs contribute `(1, 1)`. Pure data,
/// no RNG — the engine stays agnostic.
pub fn type_chart_mult(move_index: usize, defender_indices: &[usize]) -> (u32, u32) {
    let (mut num, mut den) = (1u32, 1u32);
    for &def in defender_indices {
        let (n, d) = TYPE_CHART
            .iter()
            .find(|(a, b, _, _)| *a == move_index && *b == def)
            .map(|(_, _, n, d)| (*n, *d))
            .unwrap_or((1, 1));
        num *= n;
        den *= d;
    }
    (num, den)
}

/// Non-volatile status set: only what the Leftovers-ordering proof needs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    /// Poison — chips `1/8` max HP each end-of-turn (order 10), *before*
    /// Leftovers heals (order 20).
    Poisoned,
}

/// The ability id set (design §3.1: an opaque associated type; the engine never
/// reads its meaning — only the resolver maps it to a `&'static Effect`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Ability {
    /// No ability.
    None,
    /// On switch-in, lower the foe's Attack one stage (via `TryBoost`).
    Intimidate,
    /// Veto any stat-stage *drop* targeting the holder (gates Intimidate).
    ClearBody,
}

/// The held-item id set.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Item {
    /// No item.
    None,
    /// Heal `1/16` max HP each end-of-turn, ordered AFTER the status chip.
    Leftovers,
}

/// A species = the battler's static identity: its ability, held item, and
/// elemental type. `BattlerState` has no ability/item field, so the resolvers
/// read identity off here (same shape as the engine's own mock game, which reads
/// markers off `species`). Only `Clone + Debug` is required of `P::Species`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Species {
    /// This battler's ability.
    pub ability: Ability,
    /// This battler's held item.
    pub item: Item,
    /// This battler's elemental type.
    pub mtype: MType,
}

impl Species {
    /// A plain battler: no ability, no item, Normal type.
    pub const fn plain() -> Self {
        Species {
            ability: Ability::None,
            item: Item::None,
            mtype: MType::Normal,
        }
    }
    /// Set the ability (builder).
    pub const fn with_ability(mut self, a: Ability) -> Self {
        self.ability = a;
        self
    }
    /// Set the held item (builder).
    pub const fn with_item(mut self, i: Item) -> Self {
        self.item = i;
        self
    }
    /// Set the elemental type (builder).
    pub const fn with_type(mut self, t: MType) -> Self {
        self.mtype = t;
        self
    }
}

/// The move category — the per-move physical/special flag (Gen-4 model). The
/// engine never sees this; only [`MinimonProvider::calculate_damage`] reads it
/// to pick which stats to read. **This is the split, design §5.**
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Category {
    /// Reads attacker `Atk` / defender `Def`.
    Physical,
    /// Reads attacker `SpA` / defender `SpD`.
    Special,
}

/// A move: a base power, a category (the split flag), an attacking element (its
/// `type`, doc 12 §2.1 — pure data, no handler on the move), and an id so the
/// move resolver can attach a `&'static Effect` (the damage + effectiveness hook).
#[derive(Debug, Clone, PartialEq)]
pub struct Move {
    /// Base power.
    pub power: u8,
    /// Physical (Atk/Def) vs Special (SpA/SpD) — the split flag.
    pub category: Category,
    /// The move's attacking element (doc 12: the chart needs the MOVE's type).
    pub mtype: MType,
    /// Stable id keying the move's `&'static Effect`.
    pub id: u32,
}

/// The two demo moves: one physical, one special. Distinct stat reads ⇒ distinct
/// outcomes against the same battler whose Atk≠SpA / Def≠SpD. Both are `Normal`
/// type ⇒ never an authored chart edge ⇒ existing split/Intimidate tests are
/// byte-identical.
pub const TACKLE: Move = Move {
    power: 40,
    category: Category::Physical,
    mtype: MType::Normal,
    id: MOVE_TACKLE_ID,
};
/// A special-category demo move (same base power as [`TACKLE`] so the *only*
/// difference in outcome is which stats are read).
pub const EMBER: Move = Move {
    power: 40,
    category: Category::Special,
    mtype: MType::Normal,
    id: MOVE_EMBER_ID,
};

// ── The 金木水火土 type-chart proof moves (doc 12 §4). `atk == def` in the tests
//    so base damage == power, isolating the chart fold. Each carries its element.
/// 金 Metal, power 80 (the doc 12 §4 worked attacker for super-effective/resisted).
pub const BLADE: Move = Move {
    power: 80,
    category: Category::Physical,
    mtype: MType::Metal,
    id: MOVE_BLADE_ID,
};
/// 水 Water, power 80 (the doc 12 §4 worked attacker for the immune case vs Wood).
pub const TORRENT: Move = Move {
    power: 80,
    category: Category::Special,
    mtype: MType::Water,
    id: MOVE_TORRENT_ID,
};

const MOVE_TACKLE_ID: u32 = 1;
const MOVE_EMBER_ID: u32 = 2;
const MOVE_BLADE_ID: u32 = 3;
const MOVE_TORRENT_ID: u32 = 4;

// ── The generic resource pool (doc 13 §4): minimon's MP. ─────────────────────
//
// The engine assigns the resource NO meaning (it is "MP" only here); minimon
// picks the opaque engine resource id and tags its special moves with a cost.

/// minimon's resource kinds. A single resource, `Mp` (mana points), proves the
/// generic engine pool: special (五行/elemental) moves spend it, physical moves
/// do not. The engine sees only the opaque id [`MP`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Resource {
    /// Mana points — spent by special (elemental) moves.
    Mp,
}

impl Resource {
    /// The opaque engine resource id for this kind (the id stored in
    /// [`ResourcePool`](dotzuki_engine::battle::ResourcePool) /
    /// [`BattleProvider::move_cost`]).
    pub const fn id(self) -> u16 {
        match self {
            Resource::Mp => 0,
        }
    }
}

/// The opaque engine resource id for [`Resource::Mp`] (a `const` for terse use in
/// move-cost tables and tests).
pub const MP: u16 = Resource::Mp.id();

/// The MP cost of each move (doc 13 §4). The two special (元素/elemental) moves
/// cost MP; the two physical (Normal) moves cost nothing. Keyed by move id so the
/// provider's `move_cost` hook can hand the engine the right `(id, amount)` slice.
const BLADE_COST: &[(u16, u16)] = &[(MP, 3)];
const TORRENT_COST: &[(u16, u16)] = &[(MP, 5)];
const NO_COST: &[(u16, u16)] = &[];

// ─────────────────────────────────────────────────────────────────────────────
// 2. The typed per-effect-state enum (design §3.1). minimon uses no per-effect
//    counters in this proof, so it is a single inert marker — but the type must
//    exist for the `EffectStateKind` associated type.
// ─────────────────────────────────────────────────────────────────────────────

/// The game-supplied typed per-effect-state enum. This proof hosts no stateful
/// volatile, so it is a single inert marker (the shape the engine routes by host
/// and stamps `effect_order` on).
#[derive(Clone, Debug)]
pub enum Kind {
    /// The inert variant.
    None,
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. The provider — the physical/special split lives entirely in calculate_damage
//    (design §5: NO engine change), and the four defaulted resolvers route opaque
//    ability/item/field ids to the authored `&'static Effect`s (design §2.4).
// ─────────────────────────────────────────────────────────────────────────────

/// The minimon game provider. `weather_on` toggles whether Sandstorm is live on
/// the field (the `field_effects` resolver consults it).
pub struct MinimonProvider {
    /// Whether Sandstorm is currently on the field.
    pub weather_on: bool,
    /// When `true`, ALL native `effect_for_*` / `field_effects` resolvers return
    /// nothing (Phase 2): the DATA driver ([`data::DataBattle`]) supplies effects
    /// from the compiled `rules.ron` registry instead, so the native oracle's
    /// effects are NOT double-collected when the data driver folds an event. The
    /// native oracle uses the default (`false`) and is byte-identical to before.
    pub data_mode: bool,
}

impl Default for MinimonProvider {
    fn default() -> Self {
        Self {
            weather_on: false,
            data_mode: false,
        }
    }
}

impl BattleProvider for MinimonProvider {
    type Monster = ();
    type Move = Move;
    type Ability = Ability;
    type Status = Status;
    type Stat = Stat;
    type Species = Species;
    type Type = MType;
    type Item = Item;

    /// **The physical/special split (design §5) — pure game logic, no engine
    /// change.** A physical move reads attacker `Atk` / defender `Def`; a special
    /// move reads attacker `SpA` / defender `SpD`. The engine hands whole
    /// `BattlerState`s and gets a number back; it never knows which stats were
    /// read (the stat key is opaque `P::Stat`). The formula is a deliberately
    /// tiny, deterministic `power * atk / def` (no rolls) so the proof's outcomes
    /// are hand-checkable.
    fn calculate_damage(
        &self,
        move_: &Self::Move,
        attacker: &BattlerState<Self>,
        defender: &BattlerState<Self>,
        _random: u8,
        _is_critical: bool,
    ) -> DamageResult {
        let (atk_stat, def_stat) = match move_.category {
            Category::Physical => (Stat::Atk, Stat::Def),
            Category::Special => (Stat::SpA, Stat::SpD),
        };
        let atk = read_effective_stat(attacker, atk_stat).max(1);
        let def = read_effective_stat(defender, def_stat).max(1);
        let dmg = (move_.power as u32 * atk as u32 / def as u32) as u16;
        DamageResult {
            damage: dmg.max(1),
            effectiveness: 1.0,
            is_miss: false,
        }
    }

    fn select_move(&self, b: &BattlerState<Self>, _s: &BattleState<Self>) -> Self::Move {
        b.moves.first().cloned().unwrap()
    }
    fn apply_move_effect(
        &self,
        _e: MoveEffect,
        _u: &mut BattlerState<Self>,
        _t: &mut BattlerState<Self>,
    ) -> EffectResult {
        EffectResult::NoEffect
    }
    fn create_monster(&self, s: Self::Species, _l: u8) -> BattlerState<Self> {
        BattlerState::new(s, 100, 100, EnumMap::new(), vec![])
    }

    /// **The MP cost gate (doc 13 §4) — the generic resource hook.** The two
    /// special (元素/elemental) moves cost MP; the two physical (Normal) moves
    /// cost nothing. The engine reads this slice before resolving the move; it
    /// never learns the resource is "MP" (the id is opaque). In `data_mode` the
    /// cost comes from the compiled `rules.ron` registry instead (so the native
    /// resolvers stay silent, mirroring the effect resolvers).
    fn move_cost(&self, move_: &Self::Move) -> &[(u16, u16)] {
        if self.data_mode {
            return NO_COST; // the DATA driver supplies the cost from rules.ron.
        }
        match move_.id {
            MOVE_BLADE_ID => BLADE_COST,
            MOVE_TORRENT_ID => TORRENT_COST,
            _ => NO_COST, // Tackle / Ember are free physical/neutral moves.
        }
    }
}

impl EffectProvider for MinimonProvider {
    type EffectStateKind = Kind;

    /// Each move attaches its damage hook (the `ModifyDamage` writer) plus the
    /// shared `Effectiveness` chart fold (doc 12 §3.3: one chart-scan body,
    /// parameterized per move-type by the effect's id). Untyped (`Normal`) moves
    /// use `MOVE_DAMAGE_EFFECT` whose chart lookup is always neutral; the typed
    /// 金木水火土 moves use per-element effects so the handler can recover the
    /// in-flight move's element from `source_effect`.
    fn effect_for_move(&self, m: &Self::Move) -> Option<&'static Effect<Self>> {
        if self.data_mode {
            return None; // Phase 2: the data driver supplies the move's effects.
        }
        match m.id {
            MOVE_TACKLE_ID => Some(&MOVE_DAMAGE_EFFECT),
            MOVE_EMBER_ID => Some(&MOVE_DAMAGE_EFFECT),
            MOVE_BLADE_ID => Some(&MOVE_METAL_EFFECT),
            MOVE_TORRENT_ID => Some(&MOVE_WATER_EFFECT),
            _ => None,
        }
    }

    /// Poison registers the end-of-turn chip (order 10).
    fn effect_for_status(&self, s: &Self::Status) -> Option<&'static Effect<Self>> {
        if self.data_mode {
            return None;
        }
        match s {
            Status::Poisoned => Some(&POISON_EFFECT),
        }
    }

    /// Ability resolver (design §2.4): map the battler's opaque ability id to its
    /// authored `&'static Effect`. Intimidate (SwitchIn) and Clear Body (TryBoost)
    /// are hosted here — "abilities are just Effects".
    fn effect_for_ability(&self, b: &BattlerState<Self>) -> Option<&'static Effect<Self>> {
        if self.data_mode {
            return None;
        }
        match b.species.ability {
            Ability::Intimidate => Some(&INTIMIDATE),
            Ability::ClearBody => Some(&CLEAR_BODY),
            Ability::None => None,
        }
    }

    /// Item resolver (design §2.4): Leftovers (Residual heal).
    fn effect_for_item(&self, b: &BattlerState<Self>) -> Option<&'static Effect<Self>> {
        if self.data_mode {
            return None;
        }
        match b.species.item {
            Item::Leftovers => Some(&LEFTOVERS),
            Item::None => None,
        }
    }

    /// Field resolver (design §2.4): Sandstorm, hosted on the field
    /// ([`EffectHost::Field`]). Live only while `weather_on`.
    fn field_effects(&self, _ctx: &BattleCtx<'_, Self>) -> &[&'static Effect<Self>] {
        if self.weather_on && !self.data_mode {
            &SANDSTORM_LIST
        } else {
            &[]
        }
    }

    fn turn_order_rank(
        &self,
        _state: &BattleState<Self>,
        _who: BattlerRef,
        _action: &Self::Move,
    ) -> (i32, i32) {
        (0, 0)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Generic stat reads — shared by calculate_damage and the WeatherModifyStat
//    layering. `read_effective_stat` applies the stat *stage* (Gen-style ±N) to
//    the base stat; `read_special_defense_with_weather` shows the
//    ModifyStat → WeatherModifyStat layering Sandstorm needs.
// ─────────────────────────────────────────────────────────────────────────────

/// Read a battler's effective stat = base stat scaled by its stat stage. A
/// positive stage multiplies up, a negative stage multiplies down — the Gen
/// stage table, simplified to `(2+|s|)/2` up / `2/(2+|s|)` down so a `-1` Atk
/// stage cuts damage (Intimidate's whole point).
pub(crate) fn read_effective_stat<P: EffectProvider<Stat = Stat>>(
    b: &BattlerState<P>,
    stat: Stat,
) -> u16 {
    let base = b.stats.get(stat).copied().unwrap_or(0);
    let stage = b.stat_stages.get(stat).copied().unwrap_or(0);
    apply_stage(base, stage)
}

/// The simplified Gen stat-stage multiplier.
fn apply_stage(base: u16, stage: i8) -> u16 {
    let base = base as u32;
    let v = if stage >= 0 {
        base * (2 + stage as u32) / 2
    } else {
        base * 2 / (2 + (-stage) as u32)
    };
    v.min(u16::MAX as u32) as u16
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. The authored effects — every one is a `const`/`static` of zero-capture
//    `fn`s via the `effect!` macro (design §4.1/§4.2). No engine edit, no
//    `if gen==N`, no `if ability==`.
// ─────────────────────────────────────────────────────────────────────────────

/// The move's damage hook: on `ModifyDamage`, write the split-aware
/// `calculate_damage` result into `ctx.mv.damage`. The driver helper applies
/// `ctx.mv.damage` to the target after the fold (matching the engine driver).
///
/// The provider isn't in `BattleCtx`, so the damage *number* is precomputed by
/// the driver helper (which holds `&P`) and stashed in `ctx.mv.damage`; this hook
/// is the subscription point that proves the move's effect rides `ModifyDamage`.
fn move_damage_hook<P: EffectProvider + ?Sized>(
    _ctx: &mut BattleCtx<'_, P>,
    _r: RelayVar,
    _t: BattlerRef,
    _s: BattlerRef,
    _e: EffectId,
) -> HandlerResult {
    // Damage is precomputed by the split-aware `calculate_damage` and already in
    // `ctx.mv.damage` (see `fire_move`); this hook exists so the move subscribes
    // to ModifyDamage like any cross-gen move would.
    HandlerResult::Unchanged
}

/// The shared `Effectiveness` chart fold (doc 12 §3.3/§5.2). Zero-capture: it
/// recovers the in-flight move's element from `source_effect` (the move effect's
/// id), reads the defender's element(s) off `Species.mtype` as opaque chart
/// indices, folds the chart PRODUCT into a SINGLE rational (doc 12 §5.3), and
/// `Set`s the `RelayVar::Damage` relay scaled by it. Pure data, no RNG. With a
/// neutral pair (e.g. a `Normal` move, or an omitted edge) the rational is
/// `(1, 1)` ⇒ identity ⇒ existing tests byte-identical.
fn effectiveness_chart_hook(
    ctx: &mut BattleCtx<'_, MinimonProvider>,
    relay: RelayVar,
    target: BattlerRef,
    _source: BattlerRef,
    source_effect: EffectId,
) -> HandlerResult {
    let move_index = match move_type_for_effect(source_effect) {
        Some(t) => t.chart_index(),
        None => return HandlerResult::Unchanged, // untyped ⇒ neutral
    };
    // The defender's type(s) as opaque chart indices (a slice ⇒ dual-typing is a
    // pure data change — doc 12 §3.2/§5.3). minimon battlers have one type.
    let def_indices = [ctx.battler(target).species.mtype.chart_index()];
    let (num, den) = type_chart_mult(move_index, &def_indices);
    HandlerResult::Set(relay.scale(num, den)) // ONE scale on the combined rational
}

/// Recover a move effect's attacking element from its `EffectId` (the per-element
/// parameterization of the shared chart-scan handler, doc 12 §3.3).
fn move_type_for_effect(e: EffectId) -> Option<MType> {
    match e {
        x if x == EffectId(MOVE_BLADE_ID) => Some(MType::Metal),
        x if x == EffectId(MOVE_TORRENT_ID) => Some(MType::Water),
        _ => None, // MOVE_DAMAGE_EFFECT (Normal/untyped) ⇒ neutral
    }
}

/// Every untyped (`Normal`) damaging move shares this effect: damage rides
/// `ModifyDamage`, and the `Effectiveness` hook is present but resolves neutral
/// (its `source_effect` has no element) ⇒ a provable identity fold.
pub static MOVE_DAMAGE_EFFECT: Effect<MinimonProvider> = Effect {
    id: EffectId(MOVE_TACKLE_ID),
    kind: EffectType::Move,
    hooks: &[
        EventHook {
            event: Event::ModifyDamage,
            call: move_damage_hook::<MinimonProvider>,
            order: u32::MAX,
            priority: 0,
            sub_order: None,
        },
        EventHook {
            event: Event::Effectiveness,
            call: effectiveness_chart_hook,
            order: 100,
            priority: 0,
            sub_order: None,
        },
    ],
};

/// 金 Metal move effect: same shared chart-scan hook, but its id makes
/// `move_type_for_effect` return `Metal` (doc 12 §3.3 per-type op-list).
pub static MOVE_METAL_EFFECT: Effect<MinimonProvider> = Effect {
    id: EffectId(MOVE_BLADE_ID),
    kind: EffectType::Move,
    hooks: &[
        EventHook {
            event: Event::ModifyDamage,
            call: move_damage_hook::<MinimonProvider>,
            order: u32::MAX,
            priority: 0,
            sub_order: None,
        },
        EventHook {
            event: Event::Effectiveness,
            call: effectiveness_chart_hook,
            order: 100,
            priority: 0,
            sub_order: None,
        },
    ],
};

/// 水 Water move effect: id ⇒ `move_type_for_effect` returns `Water`.
pub static MOVE_WATER_EFFECT: Effect<MinimonProvider> = Effect {
    id: EffectId(MOVE_TORRENT_ID),
    kind: EffectType::Move,
    hooks: &[
        EventHook {
            event: Event::ModifyDamage,
            call: move_damage_hook::<MinimonProvider>,
            order: u32::MAX,
            priority: 0,
            sub_order: None,
        },
        EventHook {
            event: Event::Effectiveness,
            call: effectiveness_chart_hook,
            order: 100,
            priority: 0,
            sub_order: None,
        },
    ],
};

// ── (b) Intimidate — on SwitchIn, lower the foe's Atk one stage (design §4.2b).
//
// The handler can't take `&P` (zero-capture contract), and the *veto* (Clear
// Body) must be able to gate the drop. So the SwitchIn handler records INTENT
// (a request to drop the foe's Atk) into `ctx.mv` and the driver helper
// (`switch_in`) — which holds `&P` — fires the actual `TryBoost` dispatch where
// BOTH Intimidate's request and Clear Body's veto are collected and folded in
// comparator order. This is the design's "routes through TryBoost (Clear Body
// can veto)" expressed within the zero-capture handler contract.

/// Intimidate's `SwitchIn` handler: stash a `-1 Atk` boost *request* targeting
/// the foe. `last_damage` is repurposed as a scratch "pending boost delta"
/// channel (MoveContext is the per-action scratch the engine hands every
/// handler); the driver reads it and fires `TryBoost`.
fn intimidate_switch_in<P: EffectProvider + ?Sized>(
    ctx: &mut BattleCtx<'_, P>,
    _r: RelayVar,
    _target: BattlerRef,
    _source: BattlerRef,
    _e: EffectId,
) -> HandlerResult {
    // Encode "I want to drop one Atk stage on the foe" as a signed delta in the
    // per-action scratch. The driver (`switch_in`) reads it and routes it through
    // a real TryBoost dispatch so Clear Body gets its veto.
    ctx.mv.damage = INTIMIDATE_PENDING; // sentinel: a boost request is pending
    HandlerResult::Unchanged
}

/// Sentinel stashed in `MoveContext.damage` to signal a pending Intimidate drop.
const INTIMIDATE_PENDING: u16 = 0xABCD;

/// Intimidate, hosted on the battler, resolved by `effect_for_ability`; listens
/// on `SwitchIn` (design §4.2b).
pub static INTIMIDATE: Effect<MinimonProvider> = Effect {
    id: EffectId(0xA1),
    kind: EffectType::Condition,
    hooks: &[EventHook {
        event: Event::SwitchIn,
        call: intimidate_switch_in::<MinimonProvider>,
        order: 10,
        priority: 0,
        sub_order: None,
    }],
};

// ── (c) Clear Body — veto a stat-stage DROP targeting the holder (design §4.2/§6.1).

/// Clear Body's `TryBoost` handler: if the relay is a *negative* boost delta
/// targeting the holder, veto it (`Fail`). A non-negative delta passes through.
/// Fires on the SAME `TryBoost` dispatch as Intimidate's request — both
/// abilities firing on one event in comparator order (the §6.1 proof).
fn clear_body_try_boost<P: EffectProvider + ?Sized>(
    _ctx: &mut BattleCtx<'_, P>,
    relay: RelayVar,
    _target: BattlerRef,
    _source: BattlerRef,
    _e: EffectId,
) -> HandlerResult {
    if relay.as_int() < 0 {
        // Veto the drop. `Fail` → the fold returns Bool(false) → the driver
        // skips the boost application.
        HandlerResult::Fail
    } else {
        HandlerResult::Unchanged
    }
}

/// Clear Body, hosted on the battler, resolved by `effect_for_ability`; listens
/// on `TryBoost`. `order` 5 ⇒ fires before any later TryBoost contributor.
pub static CLEAR_BODY: Effect<MinimonProvider> = Effect {
    id: EffectId(0xA2),
    kind: EffectType::Condition,
    hooks: &[EventHook {
        event: Event::TryBoost,
        call: clear_body_try_boost::<MinimonProvider>,
        order: 5,
        priority: 0,
        sub_order: None,
    }],
};

// ── (d) Leftovers — heal 1/16 max HP each end-of-turn (design §4.2c), ORDERED
//        after the poison status chip (order 20 > the chip's order 10).

fn leftovers_residual<P: EffectProvider<Stat = Stat> + ?Sized>(
    ctx: &mut BattleCtx<'_, P>,
    _r: RelayVar,
    host: BattlerRef,
    _src: BattlerRef,
    _e: EffectId,
) -> HandlerResult {
    let max = ctx.battler(host).max_hp;
    let amt = (max / 16).max(1);
    ctx.battler_mut(host).heal(amt);
    HandlerResult::Unchanged
}

/// Leftovers, hosted on the battler, resolved by `effect_for_item`; listens on
/// `Residual` at `order` 20 — AFTER the poison chip (order 10). The cross-source
/// residual ordering (status-effect chip vs item-effect heal) is exactly the
/// case the `order` comparator tier exists for (design §6.1 #4).
pub static LEFTOVERS: Effect<MinimonProvider> = effect!(EffectId(0xB1), EffectType::Condition, {
    Residual(20) => leftovers_residual::<MinimonProvider>,
});

// ── The poison status chip (the "status chip" Leftovers must heal AFTER).

fn poison_residual<P: EffectProvider<Stat = Stat> + ?Sized>(
    ctx: &mut BattleCtx<'_, P>,
    _r: RelayVar,
    host: BattlerRef,
    _src: BattlerRef,
    _e: EffectId,
) -> HandlerResult {
    let max = ctx.battler(host).max_hp;
    let amt = (max / 8).max(1);
    ctx.battler_mut(host).take_damage(amt);
    HandlerResult::Unchanged
}

/// Poison, resolved by `effect_for_status`; `Residual` at `order` 10 (before
/// Leftovers' order 20).
pub static POISON_EFFECT: Effect<MinimonProvider> = effect!(EffectId(0xC1), EffectType::Status, {
    Residual(10) => poison_residual::<MinimonProvider>,
});

// ── (e) Sandstorm — FieldResidual chip (non-Rock) + WeatherModifyStat SpD boost
//        for Rock (design §4.2d). Field-hosted (EffectHost::Field), resolved by
//        field_effects.

/// Sandstorm's `FieldResidual`: chip `1/16` max HP from every non-Rock active
/// battler. Iterates both actives; the driver uses `run_event_checked` so a
/// chip that KOs one battler doesn't fire a stale later handler (the §2.3
/// re-check) — though here each chip targets its own host.
fn sandstorm_chip<P: EffectProvider<Stat = Stat, Species = Species> + ?Sized>(
    ctx: &mut BattleCtx<'_, P>,
    _r: RelayVar,
    target: BattlerRef,
    _s: BattlerRef,
    _e: EffectId,
) -> HandlerResult {
    if ctx.battler(target).species.mtype != MType::Rock {
        let max = ctx.battler(target).max_hp;
        let amt = (max / 16).max(1);
        ctx.battler_mut(target).take_damage(amt);
    }
    HandlerResult::Unchanged
}

/// Sandstorm's `WeatherModifyStat`: when the SpD read is folded, multiply by 1.5
/// for a Rock-type. This LAYERS after `ModifyStat` (the base/burn/Choice fold) —
/// the design's `ModifyStat → WeatherModifyStat` ordering. Here it scales the
/// `Int` relay carrying the SpD value.
fn sandstorm_spd_boost<P: EffectProvider<Stat = Stat, Species = Species> + ?Sized>(
    ctx: &mut BattleCtx<'_, P>,
    relay: RelayVar,
    target: BattlerRef,
    _s: BattlerRef,
    _e: EffectId,
) -> HandlerResult {
    if ctx.battler(target).species.mtype == MType::Rock {
        return HandlerResult::Set(relay.scale(3, 2)); // ×1.5 SpD
    }
    HandlerResult::Unchanged
}

/// Sandstorm, hosted on the FIELD ([`EffectHost::Field`]), resolved by
/// `field_effects`; subscribes to `FieldResidual` (chip) and
/// `WeatherModifyStat` (the SpD boost layered after `ModifyStat`).
pub static SANDSTORM: Effect<MinimonProvider> = effect!(EffectId(0xF1), EffectType::Condition, {
    FieldResidual     => sandstorm_chip::<MinimonProvider>,
    WeatherModifyStat => sandstorm_spd_boost::<MinimonProvider>,
});

/// The provider-owned single-element list `field_effects` borrows from.
pub static SANDSTORM_LIST: [&Effect<MinimonProvider>; 1] = [&SANDSTORM];

// ─────────────────────────────────────────────────────────────────────────────
// 6. The game's driver helpers — they OWN the re-entrant dispatch (they hold
//    `&P`), build owned snapshots via `collect_handlers`, and fold via
//    `run_event`/`run_event_checked`. Handlers stay zero-capture, touching only
//    `ctx`. This is the §2.3 collect-then-fold borrow discipline, mirrored from
//    the engine's own `StackDriver`. No RefCell/Rc/unsafe.
// ─────────────────────────────────────────────────────────────────────────────

/// A self-contained battle scratch the driver helpers operate on: owns the
/// `BattleState`, the effect arena, the per-action `MoveContext`, the RNG, and
/// the provider. A test builds one, calls the helpers, then asserts on `.state`.
pub struct Battle {
    /// The provider (owns the registry + the `weather_on` flag).
    pub provider: MinimonProvider,
    /// The two parties + field.
    pub state: BattleState<MinimonProvider>,
    /// The live per-effect-state arena (kept sorted by id; minimon hosts no
    /// stateful arena effect in this proof, so it stays empty).
    pub effects: Vec<EffectState<MinimonProvider>>,
    /// Per-action scratch (damage, the Intimidate-pending sentinel, …).
    pub mv: MoveContext,
    /// The only randomness source (no `rand`).
    pub rng: ScriptedRng,
}

impl Battle {
    /// Build a battle from one player and one opponent battler.
    pub fn new(
        provider: MinimonProvider,
        player: BattlerState<MinimonProvider>,
        opponent: BattlerState<MinimonProvider>,
    ) -> Self {
        Self {
            provider,
            state: BattleState::new(vec![player], vec![opponent]),
            effects: Vec::new(),
            mv: MoveContext::default(),
            rng: ScriptedRng::new(vec![]),
        }
    }

    /// **Switch-in (design §4.2b/§6.1 #2/#3).** Fire `SwitchIn` for `who`, then,
    /// if an ability requested a stat drop (Intimidate), route it through a real
    /// `TryBoost` dispatch where the foe's Clear Body can veto. Both abilities
    /// fire on ONE `TryBoost`, in comparator order.
    pub fn switch_in(&mut self, who: BattlerRef) {
        let foe = opposing(who);

        // 1. Fire SwitchIn collecting from every source (the entrant's ability).
        //    Intimidate's handler records a pending -1 Atk request in `mv.damage`.
        //    NOTE the disjoint-field borrow: `&self.provider` is borrowed
        //    alongside a `BattleCtx` built from the *other four* fields — the game
        //    driver owns the re-entry (it holds `&P`), handlers stay zero-capture.
        self.mv.damage = 0;
        {
            let provider = &self.provider;
            let mut ctx = BattleCtx {
                state: &mut self.state,
                effects: &mut self.effects,
                mv: &mut self.mv,
                rng: &mut self.rng,
            };
            let mut hs = Vec::new();
            collect_handlers(
                &ctx,
                provider,
                None,
                Event::SwitchIn,
                who, // target = the entrant (ability hosted on it)
                who, // source = the entrant
                &mut hs,
            );
            run_event(&mut ctx, hs, RelayVar::Unit, false);
        }

        // 2. If Intimidate requested a drop, fire TryBoost on the FOE. Clear Body
        //    on the foe (target) is collected on the SAME dispatch and can `Fail`
        //    (veto). The relay carries the boost delta (-1).
        if self.mv.damage == INTIMIDATE_PENDING {
            self.mv.damage = 0;
            let vetoed = self.try_boost(foe, who, Stat::Atk, -1);
            if !vetoed {
                let cur = self
                    .battler_ref(foe)
                    .stat_stages
                    .get(Stat::Atk)
                    .copied()
                    .unwrap_or(0);
                self.battler_mut_ref(foe)
                    .stat_stages
                    .set(Stat::Atk, cur - 1);
            }
        }
    }

    /// Fire a `TryBoost` dispatch for a stat-stage change on `target` from
    /// `source`. Returns `true` if the change was **vetoed** (a handler — e.g.
    /// Clear Body — returned `Fail`/`FailSilent`). The boost delta rides the
    /// `Int` relay so the veto can inspect its sign.
    pub fn try_boost(
        &mut self,
        target: BattlerRef,
        source: BattlerRef,
        _stat: Stat,
        delta: i64,
    ) -> bool {
        let provider = &self.provider;
        let mut ctx = BattleCtx {
            state: &mut self.state,
            effects: &mut self.effects,
            mv: &mut self.mv,
            rng: &mut self.rng,
        };
        let mut hs = Vec::new();
        collect_handlers(
            &ctx,
            provider,
            None,
            Event::TryBoost,
            target,
            source,
            &mut hs,
        );
        let out = run_event(&mut ctx, hs, RelayVar::Int(delta), false);
        // A `Fail`/`FailSilent` fold returns Bool(false)/Unit → vetoed.
        matches!(out, RelayVar::Bool(false) | RelayVar::Unit)
    }

    /// **Fire one damaging move (design §5 split).** Compute the split-aware
    /// damage (physical vs special), stash it in `mv.damage`, fire `ModifyDamage`
    /// (the move subscribes here), apply the damage, then fire `DamagingHit`.
    pub fn fire_move(&mut self, attacker: BattlerRef, move_: &Move) {
        let target = opposing(attacker);

        // ── MP COST GATE (doc 13 §4), mirroring the engine driver's
        //    `resolve_action` cost check. The provider's `move_cost` hands the
        //    opaque `(resource_id, amount)` slice. Game policy: a battler that does
        //    NOT declare the resource at all treats the move as FREE (so the
        //    cost-free chart/split battlers are byte-identical to before); a
        //    battler that DOES declare it must afford the cost or the move is
        //    PREVENTED (early return, no damage, no deduction). Deduction is pure
        //    arithmetic — no rng.
        if !self.pay_move_cost(attacker, move_) {
            return; // insufficient MP ⇒ move prevented
        }

        // Split-aware damage, computed by the provider (holds the formula).
        let dmg = {
            let a = self.battler_ref(attacker).clone();
            let d = self.battler_ref(target).clone();
            self.provider
                .calculate_damage(move_, &a, &d, 0, false)
                .damage
        };
        self.mv.damage = dmg;

        let Some(eff) = self.provider.effect_for_move(move_) else {
            return;
        };
        let provider = &self.provider;
        let mut ctx = BattleCtx {
            state: &mut self.state,
            effects: &mut self.effects,
            mv: &mut self.mv,
            rng: &mut self.rng,
        };
        // ModifyDamage (the move's hook rides here).
        let mut hs = Vec::new();
        collect_handlers(
            &ctx,
            provider,
            Some(eff),
            Event::ModifyDamage,
            target,
            attacker,
            &mut hs,
        );
        run_event(&mut ctx, hs, RelayVar::Unit, false);
        // ── Effectiveness fold (doc 12 §1.1, line-identical to the engine driver's
        //    resolve_action insertion). Lift the formula damage into the Damage
        //    lane, fire Effectiveness (the chart hook folds it via scale), write
        //    back. Inert (1×) when the chart edge is neutral/omitted.
        let mut hs = Vec::new();
        collect_handlers(
            &ctx,
            provider,
            Some(eff),
            Event::Effectiveness,
            target,
            attacker,
            &mut hs,
        );
        let eff_in = RelayVar::Damage(ctx.mv.damage);
        let eff_out = run_event(&mut ctx, hs, eff_in, false);
        ctx.mv.damage = eff_out.as_damage();
        // Apply the damage and fire DamagingHit.
        let dmg = ctx.mv.damage;
        if dmg > 0 {
            ctx.battler_mut(target).take_damage(dmg);
            ctx.mv.last_damage = dmg;
        }
        let mut hs = Vec::new();
        collect_handlers(
            &ctx,
            provider,
            Some(eff),
            Event::DamagingHit,
            target,
            attacker,
            &mut hs,
        );
        run_event(&mut ctx, hs, RelayVar::Damage(dmg), false);
    }

    /// Charge the MP cost of `move_` to `attacker` (doc 13 §4). Returns `true` if
    /// the move may proceed (cost paid, or the actor declares no such resource so
    /// the move is free), `false` if the actor declares the resource but cannot
    /// afford it (the move is PREVENTED). Pure arithmetic — no rng.
    fn pay_move_cost(&mut self, attacker: BattlerRef, move_: &Move) -> bool {
        let costs: Vec<(u16, u16)> = self.provider.move_cost(move_).to_vec();
        let b = self.battler_mut_ref(attacker);
        for (id, amt) in &costs {
            // A battler that does NOT declare this resource treats the move as
            // FREE (skip the gate) — keeps the cost-free chart/split battlers
            // byte-identical. A battler that DOES declare it must afford the cost.
            if b.resources.current(*id).is_none() {
                continue;
            }
            if !b.can_pay_resource(*id, *amt) {
                return false; // declared but unaffordable ⇒ prevent
            }
        }
        for (id, amt) in &costs {
            if b.resources.current(*id).is_some() {
                b.pay_resource(*id, *amt);
            }
        }
        true
    }

    /// **End-of-turn residual (design §6.1 #4).** Fire one `Residual` dispatch on
    /// `who` collecting BOTH the non-volatile status chip (poison `Residual`,
    /// order 10) and the item residual (Leftovers `Residual`, order 20). The
    /// status effect is the dispatch's *source effect* (mirrors the engine
    /// driver's status route); the item is gathered by the multi-source
    /// collector. The comparator sorts by `order`, so the chip lands BEFORE the
    /// heal — proving cross-source residual ordering.
    pub fn end_of_turn_residual(&mut self, who: BattlerRef) {
        let provider = &self.provider;
        let mut ctx = BattleCtx {
            state: &mut self.state,
            effects: &mut self.effects,
            mv: &mut self.mv,
            rng: &mut self.rng,
        };
        let status_eff = provider.effect_for_status_opt(ctx.battler(who).status);
        let mut hs = Vec::new();
        collect_handlers(
            &ctx,
            provider,
            status_eff,
            Event::Residual,
            who,
            who,
            &mut hs,
        );
        run_event_checked(&mut ctx, hs, RelayVar::Unit, false);
    }

    /// **Weather end-of-turn (design §6.1 #5).** Fire `FieldResidual` for both
    /// actives — the field-hosted Sandstorm chip (non-Rock). Uses
    /// `run_event_checked` (the §2.3 liveness re-check) since the field chips
    /// multiple targets across dispatches.
    pub fn weather_residual(&mut self) {
        for who in [BattlerRef::PLAYER, BattlerRef::OPPONENT] {
            let provider = &self.provider;
            let mut ctx = BattleCtx {
                state: &mut self.state,
                effects: &mut self.effects,
                mv: &mut self.mv,
                rng: &mut self.rng,
            };
            let mut hs = Vec::new();
            collect_handlers(
                &ctx,
                provider,
                None,
                Event::FieldResidual,
                who, // target = the battler the field chips
                who,
                &mut hs,
            );
            run_event_checked(&mut ctx, hs, RelayVar::Unit, false);
        }
    }

    /// Read a battler's effective SpD with the `ModifyStat → WeatherModifyStat`
    /// layering (design §6.1 #5): start from the base+stage SpD (the `ModifyStat`
    /// lane), then fold `WeatherModifyStat` (Sandstorm ×1.5 for Rock). Returns
    /// the final SpD the damage formula would read.
    pub fn effective_spd_with_weather(&mut self, who: BattlerRef) -> u16 {
        // ModifyStat lane: the base+stage SpD value.
        let base_spd = read_effective_stat(self.battler_ref(who), Stat::SpD);
        let provider = &self.provider;
        let mut ctx = BattleCtx {
            state: &mut self.state,
            effects: &mut self.effects,
            mv: &mut self.mv,
            rng: &mut self.rng,
        };
        let mut hs = Vec::new();
        collect_handlers(
            &ctx,
            provider,
            None,
            Event::WeatherModifyStat,
            who,
            who,
            &mut hs,
        );
        let out = run_event(&mut ctx, hs, RelayVar::Int(base_spd as i64), false);
        out.as_int().max(0) as u16
    }

    /// Read access to a battler.
    pub fn battler_ref(&self, r: BattlerRef) -> &BattlerState<MinimonProvider> {
        if r.side == 0 {
            &self.state.player_battlers[r.slot as usize]
        } else {
            &self.state.opponent_battlers[r.slot as usize]
        }
    }
    fn battler_mut_ref(&mut self, r: BattlerRef) -> &mut BattlerState<MinimonProvider> {
        if r.side == 0 {
            &mut self.state.player_battlers[r.slot as usize]
        } else {
            &mut self.state.opponent_battlers[r.slot as usize]
        }
    }
}

impl MinimonProvider {
    /// Resolve a status's residual effect from an `Option<Status>` (small
    /// convenience for the residual helper).
    fn effect_for_status_opt(&self, s: Option<Status>) -> Option<&'static Effect<MinimonProvider>> {
        s.and_then(|s| self.effect_for_status(&s))
    }
}

/// The opposing battler (1v1 slot 0).
fn opposing(who: BattlerRef) -> BattlerRef {
    BattlerRef::new(if who.side == 0 { 1 } else { 0 }, who.slot)
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Battler builders — small helpers so tests read clearly.
// ─────────────────────────────────────────────────────────────────────────────

/// Build a battler with explicit Atk/Def/SpA/SpD/Spe and a species identity.
pub fn battler(
    species: Species,
    hp: u16,
    atk: u16,
    def: u16,
    spa: u16,
    spd: u16,
    spe: u16,
    moves: Vec<Move>,
) -> BattlerState<MinimonProvider> {
    let mut stats = EnumMap::new();
    stats.set(Stat::Hp, hp);
    stats.set(Stat::Atk, atk);
    stats.set(Stat::Def, def);
    stats.set(Stat::SpA, spa);
    stats.set(Stat::SpD, spd);
    stats.set(Stat::Spe, spe);
    BattlerState::new(species, hp, hp, stats, moves)
}

/// The DATA path (Phase 2): minimon's five systems re-expressed in
/// [`rules.ron`](../../rules.ron) and driven through the game-agnostic
/// `dotzuki-rules` loader, with a [`DataBattle`](data::DataBattle) driver that
/// mirrors the native [`Battle`]. The parity tests prove the two paths produce
/// byte-identical `BattleState` and identical `ScriptedRng` draws.
pub mod data;

#[cfg(test)]
mod tests;
