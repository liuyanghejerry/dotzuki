# Authoring battles on the effect stack

This page teaches battle authors how to build a battle system on
`dotzuki_engine::battle::stack`: declaring events, effects, and handlers,
writing `rules.ron`, and validating the result against the minimon example.

> - **Audience**: game authors, rust developers
> - **Type**: how-to
> - **Status**: active
> - **Last verified**: v0.1.0

Before you start, read
[`explanation/effect-stack.md`](../explanation/effect-stack.md) for the effect
stack's execution model and event/effect/handler architecture.

> **Scope.** This page covers how to build a Gen-1-to-Gen-6-*like* battle system
> on **`dotzuki_engine::battle::stack`** — the Showdown-style **effect-stack**
> battle engine — **without forking the engine**. The design and rationale live
> in [`explanation/effect-stack.md`](../explanation/effect-stack.md).
>
> The canonical worked code referenced throughout is
> [`examples/minimon/src/lib.rs`](../../examples/minimon/src/lib.rs) and its
> [`tests.rs`](../../examples/minimon/src/tests.rs): a tiny mock game that authors
> the physical/special split + Intimidate + Clear Body + Leftovers + Sandstorm —
> plus a 金木水火土 **type chart** ([§2](#2-type-effectiveness-相克--type-charts)),
> an **MP resource** with move costs ([§4](#4-resources-mpsp--move-costs)), and the
> same ruleset re-homed to **`rules.ron`** for no-code authoring
> ([`examples/minimon/rules.ron`](../../examples/minimon/rules.ron),
> [§3](#3-no-code-authoring-with-rulesron-the-dotzuki-rules-loader)) — with **zero
> engine edits**, depending on `dotzuki-engine` (and, for the data path,
> `dotzuki-rules`) only.

---

## Table of contents

1. [Tutorial: stand up a minimal ruleset (the minimon walkthrough)](#1-tutorial-stand-up-a-minimal-ruleset-the-minimon-walkthrough)
2. [Type effectiveness (相克 / type charts)](#2-type-effectiveness-相克--type-charts)
3. [No-code authoring with `rules.ron` (the dotzuki-rules loader)](#3-no-code-authoring-with-rulesron-the-dotzuki-rules-loader)
4. [Resources (MP/SP) & move costs](#4-resources-mpsp--move-costs)
5. [Cookbook: cross-gen mechanics → effect-stack recipes](#5-cookbook-cross-gen-mechanics--effect-stack-recipes)
6. [Determinism & testing](#6-determinism--testing)

---

## 1. Tutorial: stand up a minimal ruleset (the minimon walkthrough)

[`examples/minimon`](../../examples/minimon) authors a Gen-4-shaped battle system —
phys/special split + Intimidate + Clear Body + Leftovers + Sandstorm — on the
stack with **zero engine edits**. Its only dependency is the engine:

```toml
# examples/minimon/Cargo.toml
[dependencies]
dotzuki-engine = { path = "../../crates/dotzuki-engine" }
```

### Step 1 — Define the id enums (the 6-stat split shape)

The engine indexes `EnumMap<P::Stat>` by an opaque key, so choosing the split
shape is a pure data decision. minimon defines six stats and opaque ids for
type/status/ability/item, plus a `Species` struct that carries identity
(`BattlerState` has no ability/item field):

```rust
pub enum Stat { Hp, Atk, Def, SpA, SpD, Spe }      // a Gen-1 game would use {Hp,Atk,Def,Spe,Spc}
pub enum MType { Normal, Rock }
pub enum Status { Poisoned }
pub enum Ability { None, Intimidate, ClearBody }   // opaque — the engine never reads their meaning
pub enum Item { None, Leftovers }
pub struct Species { pub ability: Ability, pub item: Item, pub mtype: MType }

pub enum Category { Physical, Special }             // the per-move split flag the engine never sees
pub struct Move { pub power: u8, pub category: Category, pub id: u32 }
```

The typed per-effect-state enum is a single inert marker here, since this proof
hosts no stateful volatile:

```rust
pub enum Kind { None }
```

### Step 2 — Implement `BattleProvider` + `EffectProvider`

`calculate_damage` **is** the entire physical/special split. The engine hands
whole battler states and gets a number back; it never knows which stats were
read:

```rust
fn calculate_damage(&self, move_: &Self::Move, attacker: &BattlerState<Self>,
                    defender: &BattlerState<Self>, _random: u8, _is_critical: bool) -> DamageResult {
    let (atk_stat, def_stat) = match move_.category {
        Category::Physical => (Stat::Atk, Stat::Def),
        Category::Special  => (Stat::SpA, Stat::SpD),
    };
    let atk = read_effective_stat(attacker, atk_stat).max(1);
    let def = read_effective_stat(defender, def_stat).max(1);
    let dmg = (move_.power as u32 * atk as u32 / def as u32) as u16;
    DamageResult { damage: dmg.max(1), effectiveness: 1.0, is_miss: false }
}
```

`EffectProvider` supplies `EffectStateKind = Kind` and the resolvers that map
opaque ids to authored `&'static Effect`s — this is "abilities/items/weather are
just Effects hosted somewhere":

```rust
impl EffectProvider for MinimonProvider {
    type EffectStateKind = Kind;

    fn effect_for_move(&self, m: &Self::Move) -> Option<&'static Effect<Self>> {
        match m.id { MOVE_TACKLE_ID | MOVE_EMBER_ID => Some(&MOVE_DAMAGE_EFFECT), _ => None }
    }
    fn effect_for_status(&self, s: &Self::Status) -> Option<&'static Effect<Self>> {
        match s { Status::Poisoned => Some(&POISON_EFFECT) }
    }
    fn effect_for_ability(&self, b: &BattlerState<Self>) -> Option<&'static Effect<Self>> {
        match b.species.ability {
            Ability::Intimidate => Some(&INTIMIDATE),
            Ability::ClearBody  => Some(&CLEAR_BODY),
            Ability::None       => None,
        }
    }
    fn effect_for_item(&self, b: &BattlerState<Self>) -> Option<&'static Effect<Self>> {
        match b.species.item { Item::Leftovers => Some(&LEFTOVERS), Item::None => None }
    }
    fn field_effects(&self, _ctx: &BattleCtx<'_, Self>) -> &[&'static Effect<Self>] {
        if self.weather_on { &SANDSTORM_LIST } else { &[] }
    }
    fn turn_order_rank(&self, _s: &BattleState<Self>, _w: BattlerRef, _a: &Self::Move) -> (i32, i32) {
        (0, 0)
    }
}
```

(All other resolvers stay defaulted.)

### Step 3 — Author the 5 systems as `Effect`s

Every handler is a zero-capture `fn(&mut BattleCtx, RelayVar, target, source,
source_effect) -> HandlerResult`.

**(a) Move damage** — every damaging move shares one effect riding
`ModifyDamage`. The damage number is precomputed by the driver (which holds
`&P`) into `ctx.mv.damage`; the hook is the subscription point:

```rust
pub static MOVE_DAMAGE_EFFECT: Effect<MinimonProvider> = Effect {
    id: EffectId(MOVE_TACKLE_ID), kind: EffectType::Move,
    hooks: &[EventHook { event: Event::ModifyDamage, call: move_damage_hook::<MinimonProvider>,
                         order: u32::MAX, priority: 0, sub_order: None }],
};
```

**(b) Intimidate** — a `SwitchIn` handler can't hold `&P`, and the drop must be
vetoable, so the handler records *intent* (a sentinel in the per-action scratch)
and the driver fires the real `TryBoost`:

```rust
<!-- not verified: elided parameters, illustrative only -->
fn intimidate_switch_in<P: EffectProvider + ?Sized>(ctx: &mut BattleCtx<'_, P>, ..) -> HandlerResult {
    ctx.mv.damage = INTIMIDATE_PENDING;   // 0xABCD — a boost request is pending
    HandlerResult::Unchanged
}
pub static INTIMIDATE: Effect<MinimonProvider> = Effect {
    id: EffectId(0xA1), kind: EffectType::Condition,
    hooks: &[EventHook { event: Event::SwitchIn, call: intimidate_switch_in::<MinimonProvider>,
                         order: 10, priority: 0, sub_order: None }],
};
```

**(c) Clear Body veto** — listens on the *same* `TryBoost` dispatch; a negative
delta returns `Fail`, which folds to `Bool(false)` so the driver skips the boost:

```rust
<!-- not verified: elided parameters, illustrative only -->
fn clear_body_try_boost<P: EffectProvider + ?Sized>(_c: &mut BattleCtx<'_, P>, relay: RelayVar, ..) -> HandlerResult {
    if relay.as_int() < 0 { HandlerResult::Fail } else { HandlerResult::Unchanged }
}
pub static CLEAR_BODY: Effect<MinimonProvider> = Effect {
    id: EffectId(0xA2), kind: EffectType::Condition,
    hooks: &[EventHook { event: Event::TryBoost, call: clear_body_try_boost::<MinimonProvider>,
                         order: 5, priority: 0, sub_order: None }],
};
```

**(d) Leftovers** — `Residual(20)` heals *after* the poison chip at `Residual(10)`.
Cross-source ordering is exactly what the `order` tier exists for:

```rust
<!-- not verified: elided parameters, illustrative only -->
fn leftovers_residual<P: EffectProvider<Stat = Stat> + ?Sized>(ctx: &mut BattleCtx<'_, P>, _r, host, ..) -> HandlerResult {
    let amt = (ctx.battler(host).max_hp / 16).max(1);
    ctx.battler_mut(host).heal(amt);
    HandlerResult::Unchanged
}
pub static LEFTOVERS: Effect<MinimonProvider> = effect!(EffectId(0xB1), EffectType::Condition, {
    Residual(20) => leftovers_residual::<MinimonProvider>,
});
pub static POISON_EFFECT: Effect<MinimonProvider> = effect!(EffectId(0xC1), EffectType::Status, {
    Residual(10) => poison_residual::<MinimonProvider>,   // chips max_hp/8
});
```

**(e) Sandstorm** — field-hosted, two hooks: `FieldResidual` chips non-Rock,
`WeatherModifyStat` layers a ×1.5 SpD boost onto the relay *after* `ModifyStat`:

```rust
<!-- not verified: elided parameters, illustrative only -->
fn sandstorm_spd_boost<P: ...>(ctx, relay, target, ..) -> HandlerResult {
    if ctx.battler(target).species.mtype == MType::Rock {
        return HandlerResult::Set(relay.scale(3, 2));     // ×1.5 SpD
    }
    HandlerResult::Unchanged
}
pub static SANDSTORM: Effect<MinimonProvider> = effect!(EffectId(0xF1), EffectType::Condition, {
    FieldResidual     => sandstorm_chip::<MinimonProvider>,
    WeatherModifyStat => sandstorm_spd_boost::<MinimonProvider>,
});
pub static SANDSTORM_LIST: [&Effect<MinimonProvider>; 1] = [&SANDSTORM];   // what field_effects borrows
```

### Step 4 — Wire effects via the driver re-entry pattern

Your driver helpers own re-entrant dispatch: they hold `&P`, build an owned
snapshot via `collect_handlers`, then fold via `run_event`/`run_event_checked`.
Handlers stay zero-capture, touching only `ctx`. `switch_in` is the canonical
example — fire `SwitchIn`, and if Intimidate set the sentinel, fire a real
`TryBoost` on the foe where Clear Body is collected on the same dispatch and can
veto:

```rust
pub fn switch_in(&mut self, who: BattlerRef) {
    let foe = opposing(who);
    self.mv.damage = 0;
    {
        let provider = &self.provider;
        let mut ctx = BattleCtx { state: &mut self.state, effects: &mut self.effects,
                                  mv: &mut self.mv, rng: &mut self.rng };
        let mut hs = Vec::new();
        collect_handlers(&ctx, provider, None, Event::SwitchIn, who, who, &mut hs);
        run_event(&mut ctx, hs, RelayVar::Unit, false);
    }
    if self.mv.damage == INTIMIDATE_PENDING {
        self.mv.damage = 0;
        let vetoed = self.try_boost(foe, who, Stat::Atk, -1);   // collects Clear Body too
        if !vetoed { /* apply -1 stage */ }
    }
}

pub fn try_boost(&mut self, target, source: BattlerRef, _stat: Stat, delta: i64) -> bool {
    let provider = &self.provider;
    let mut ctx = BattleCtx { state: &mut self.state, effects: &mut self.effects,
                              mv: &mut self.mv, rng: &mut self.rng };
    let mut hs = Vec::new();
    collect_handlers(&ctx, provider, None, Event::TryBoost, target, source, &mut hs);
    let out = run_event(&mut ctx, hs, RelayVar::Int(delta), false);
    matches!(out, RelayVar::Bool(false) | RelayVar::Unit)       // Fail/FailSilent ⇒ vetoed
}
```

Note the disjoint-field borrow: `&self.provider` is borrowed alongside a
`BattleCtx` built from the *other four* fields. That is how a zero-capture
handler contract and re-entrant dispatch coexist — the driver holds `&P`, the
handler never does.

`end_of_turn_residual` passes the status effect as the dispatch's *source*
effect while the collector also gathers the item, so the `order` comparator
interleaves them; `weather_residual` loops both actives firing `FieldResidual`
with `run_event_checked`; `effective_spd_with_weather` seeds
`RelayVar::Int(base_spd)` then folds `WeatherModifyStat`.

### Step 5 — Run a turn and assert outcomes

Tests are hand-derived `BattleState` oracles (Showdown-style):

```rust
phys.fire_move(BattlerRef::PLAYER, &TACKLE);
assert_eq!(100 - phys.battler_ref(BattlerRef::OPPONENT).hp, 80);   // 40*100/Def(50)
spec.fire_move(BattlerRef::PLAYER, &EMBER);
assert_eq!(100 - spec.battler_ref(BattlerRef::OPPONENT).hp, 40);   // 40*100/SpD(100)
```

> **Using the built-in `StackDriver` instead of hand helpers.** minimon writes
> its own helpers to exercise individual events in isolation, but the engine
> ships a full turn sequencer:
> ```rust
> let result: StackTurnResult = StackDriver::execute_turn(
>     &provider, &mut state, &mut effects,
>     [BattleAction::Fight { move_: tackle }, BattleAction::Fight { move_: ember }],
>     &mut rng);
> ```
> It resolves order (`turn_order_rank` + one tie byte), fires the per-actor move
> pipeline (`BeforeMove → ModifyCritRatio → Accuracy → ModifyDamage → DamagingHit`),
> then per-mover `Residual` with the first-mover-faint short-circuit
> (`StackTurnResult { first, second_cancelled }`). Use it when you want the
> canonical Gen-1-shaped turn; use hand helpers when you want to fire one event.
---

## 2. Type effectiveness (相克 / type charts)

A type chart is **not** an engine concept. It is the
[`Event::Effectiveness`](../explanation/effect-stack.md#21-the-event-taxonomy--what-fires-and-when) fold
composing one **integer** rational multiplier with the provider's already-rolled
damage. The built-in `StackDriver` now *fires* this fold inside the move
pipeline; with no subscriber it is a provable identity no-op, so every existing
game stays byte-identical.

### 2.1 Where the fold fires, and how it composes

In `resolve_action`, `Effectiveness` fires **after `ModifyDamage`** (so
screen/item/weather multipliers precede the chart) and **before `DamagingHit`**
(so on-hit reactions see the post-effectiveness number). The fold is a
three-step **lift → fire → write-back** around the single source of truth,
`ctx.mv.damage` (`driver.rs:206-208`):

```rust
let eff_in = RelayVar::Damage(ctx.mv.damage);
let eff_out = Self::fire(&mut ctx, eff, Event::Effectiveness, target, actor, eff_in);
ctx.mv.damage = eff_out.as_damage(); // non-Damage relay ⇒ 0 (event.rs as_damage)
```

The number then lives unchanged in `ctx.mv.damage`, applied at the next line
(`driver.rs:213`):

```rust
ctx.battler_mut(target).take_damage(dmg);
```

Two consequences to respect:

- **Inert by default.** With no handler subscribing to `Effectiveness`, the
  empty-handler `run_event` returns the relay unchanged, the write-back is the
  identity, and the draw sequence is untouched (`driver.rs:196-205`,
  `event.rs:179-185`).
- **Stay in the `Damage` lane.** `as_damage()` returns `0` for any
  **non-`Damage`** relay (`event.rs:179-185`). A handler that drops the relay out
  of the `Damage` lane zeroes the move. Use `relay.scale(num, den)`, which keeps
  the relay in its lane.

### 2.2 The multiplier is integer-only

`RelayVar::scale` is **pure integer arithmetic** — no float touches the damage
path. The `Damage(v)` arm computes `(v as u64) * num / den` and clamps to
`u16::MAX`; `den` is guarded with `den.max(1)` (`event.rs:207-224`):

```rust
pub fn scale(self, num: u32, den: u32) -> RelayVar {
    let den = den.max(1);
    match self {
        RelayVar::Damage(v) => {
            let scaled = (v as u64) * (num as u64) / (den as u64);
            RelayVar::Damage(scaled.min(u16::MAX as u64) as u16)
        }
        // Int / Accuracy arms keep their own lanes; non-numeric relays pass through.
        other => other,
    }
}
```

So 2× is `relay.scale(2, 1)`, ½× is `relay.scale(1, 2)`, and a 0× immunity is
`relay.scale(0, 1)`. Fold the whole chart product into **one** pre-combined
rational and apply **exactly one** `scale` — folding per-edge would truncate at
each step.

### 2.3 Authoring natively: a const chart + one handler

minimon ships the 金木水火土 (Metal/Wood/Water/Fire/Earth) wheel as a flat
const table of `(atk_index, def_index, num, den)` rows (`lib.rs:120-135`):

```rust
pub const TYPE_CHART: &[(usize, usize, u32, u32)] = &[
    (0, 1, 2, 1), // 金克木  Metal → Wood
    (1, 4, 2, 1), // 木克土  Wood  → Earth
    (4, 2, 2, 1), // 土克水  Earth → Water
    (2, 3, 2, 1), // 水克火  Water → Fire
    (3, 0, 2, 1), // 火克金  Fire  → Metal
    (1, 0, 1, 2), // Wood  → Metal  (1/2×)
    // … the other reverse edges …
    (2, 1, 0, 1), // 水→木  Water → Wood (0× immunity)
];
```

A pure helper folds the chart **product** over the defender's type(s) into one
rational (`lib.rs:141-153`); dual-typing is then a pure data change, not a code
change:

```rust
pub fn type_chart_mult(move_index: usize, defender_indices: &[usize]) -> (u32, u32) {
    let (mut num, mut den) = (1u32, 1u32);
    for &def in defender_indices {
        let (n, d) = TYPE_CHART
            .iter()
            .find(|(a, b, _, _)| *a == move_index && *b == def)
            .map(|(_, _, n, d)| (*n, *d))
            .unwrap_or((1, 1));   // omitted pair ⇒ 1×
        num *= n;
        den *= d;
    }
    (num, den)
}
```

The handler matches `HandlerFn` exactly. It recovers the in-flight move's element
from `source_effect` (via `move_type_for_effect`, `lib.rs:576-582`), reads the
defender's element(s) off `Species.mtype`, and returns **one** `Set` with the
combined rational (`lib.rs:556-572`):

```rust
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
    let def_indices = [ctx.battler(target).species.mtype.chart_index()];
    let (num, den) = type_chart_mult(move_index, &def_indices);
    HandlerResult::Set(relay.scale(num, den)) // ONE scale on the combined rational
}
```

It is subscribed at `order: 100` on `Event::Effectiveness` in each element's move
effect — `MOVE_DAMAGE_EFFECT` (Normal/untyped ⇒ neutral identity),
`MOVE_METAL_EFFECT`, `MOVE_WATER_EFFECT` (`lib.rs:587-651`):

```rust
EventHook {
    event: Event::Effectiveness,
    call: effectiveness_chart_hook,
    order: 100, priority: 0, sub_order: None,
},
```

### 2.4 Authoring as RON data instead

The same chart is expressible **without Rust** in `rules.ron` as a `type_chart:`
list of `( atk:, def:, mult: [n, d] )` rows, applied by the `ApplyTypeChart`
primitive op on an `Effectiveness` hook (`rules.ron:39-54`, see
[§3](#3-no-code-authoring-with-rulesron-the-dotzuki-rules-loader)):

```ron
type_chart: [
    ( atk: "Metal", def: "Wood",  mult: [2, 1] ),   // 金克木
    ( atk: "Water", def: "Fire",  mult: [2, 1] ),   // 水克火
    ( atk: "Water", def: "Wood",  mult: [0, 1] ),   // 水→木 immunity
],
// … and on the move:
Hook(on: "Effectiveness", order: 100, do: [ ApplyTypeChart ]),
```

### 2.5 The asserted outcomes (160 / 80 / 40 / 0)

With a power-80 Metal blade, the four chart outcomes are exact integers — the
parity oracle (`tests.rs:338`):

```rust
assert_eq!((super_eff, neutral, resisted, immune), (160, 80, 40, 0));
```

`160 = 80 ×2/1` (金克木 super-effective), `80 = 80 ×1/1` (omitted pair ⇒
neutral), `40 = 80 ×1/2` (resisted), `0 = 80 ×0/1` (the 水→木 immunity). The
native const-chart path and the RON data path produce **identical** numbers.

> **Design background:** §12
---

## 3. No-code authoring with `rules.ron` (the dotzuki-rules loader)

[`crates/dotzuki-rules`](../../crates/dotzuki-rules/src/) is a thin authoring layer over
the effect stack: it parses a `rules.ron` file into runtime `Effect`s so you can
add **moves, abilities, items, types, and resource costs with zero Rust**. It is
**Option A** — a single `interpret()` fn keyed by `EffectId`, registered as the
`call` of each generated `Effect`. There is **zero engine change**: the engine
already threads `source_effect: eff.id` to every handler (`dispatch.rs:128`), and
`interpret` is just another `HandlerFn`.

### 3.1 The data model — effect records + a closed primitive vocabulary

The top-level shape is
`Ruleset( stats: […], resources: […], types: […], type_chart: […], effects: […] )`
(`rules.ron:20-123`; `Ruleset::from_ron` enables RON's `IMPLICIT_SOME`,
`model.rs:436-440`). Each effect is an `EffectRecord` with a `kind`
(`EffectKind { Move, Status, Ability, Item, Weather }`, `model.rs:184-196`),
optional `category`/`power`/`type`/`accuracy`/`cost`, and a list of hooks. Every
hook's `do:` is a list drawn from the **closed primitive op vocabulary**
(`enum Op`, `crates/dotzuki-rules/src/model.rs:396`) — this closed set is the
entire expressiveness budget. It grew from the original 12 to **18 ops** as
the pokered Gen-1 migration needed more primitives (`SetHp`, `SetDamage`,
`DamageCurrentHpFraction`, `RepeatHits`, `InflictVolatile`, `RemoveStatus`) —
all still closed and game-agnostic:

```rust
pub enum Op {                                        // dotzuki-rules/src/model.rs:396
    DealMoveDamage,                                  // ModifyDamage marker (provider number)
    DamageFraction { num: u32, den: u32, of: FractionOf, target: Selector, unless: Option<Predicate> },
    HealFraction   { num: u32, den: u32, of: FractionOf, target: Selector, unless: Option<Predicate> },
    InflictStatus  { status: String, target: Selector, amount: AmountSpec },
    InflictVolatile { kind: String, target: Selector, amount: AmountSpec },
    Boost          { stat: String, stages: i8, target: Selector },
    ScaleRelay     { num: u32, den: u32, when: Vec<Predicate> },
    SetRelay(i64), AddRelay(i64), ClampRelay { lo: i64, hi: i64 },
    VetoIf         { cond: Predicate, silent: bool },   // Fail when cond holds (Clear Body / Mist)
    ApplyTypeChart,                                  // fold the dual-type product into the relay
    PayResource    { resource: String, amount: u16, target: Selector }, // MP/SP cost gate
    // ── added by the pokered Gen-1 migration (still closed, still game-agnostic) ──
    SetHp          { target: Selector, value: u16, when: Vec<Predicate> }, // absolute HP set
    SetDamage      { value: DamageValue, of: Selector }, // fixed / level / rng damage
    DamageCurrentHpFraction { num: u32, den: u32, target: Selector }, // % of CURRENT hp
    RepeatHits     { count: HitCount, target: Selector, final_hit: FinalHitRider },
    RemoveStatus   { target: Selector },
}
```

Supporting closed enums:
- `Selector { Target, Foe, Host, Source }` (`model.rs:201`).
- `FractionOf { MaxHp, CurHp, LastDamage }` (default `MaxHp`; `LastDamage` = the
  damage just dealt — the drain/recoil base; `model.rs:214`).
- `Predicate { HasType(String), StatIs(String), RelayIntLt(i64), HasVolatile(String),
  MoveTypeIsDefenderType, TargetHasStatus(String), LevelGE }` (`model.rs:268`) —
  used by the `unless` / `when` / `cond` guards. (The last four were added for the
  migration: side-status Substitute/same-type vetoes, Dream Eater's sleep gate, the
  OHKO level gate.)
- `DamageValue { Const(u16), UserLevel, RngScaledLevel { num, den } }` — the source
  for `SetDamage` (Sonic Boom 20 / Dragon Rage 40 / Seismic Toss = level / Psywave;
  `model.rs:249`).
- `HitCount { Fixed(u8), TwoToFive }` + `FinalHitRider` — the count source + the
  final-hit secondary for `RepeatHits` (`model.rs:510`).

### 3.2 A real `rules.ron` excerpt

minimon's whole ruleset is data. A move declares its split (`category`/`power`),
its element (`type`), an optional `cost:`, and the hooks that subscribe it
(`rules.ron:63-89`):

```ron
Effect(id: "move.tackle", kind: Move, category: "Physical", power: 40, type: "Normal", accuracy: 100,
    hooks: [
        Hook(on: "ModifyDamage",  do: [ DealMoveDamage ]),
        Hook(on: "Effectiveness", order: 100, do: [ ApplyTypeChart ]),
    ]),
```

A status chip and a Leftovers heal show cross-source `order` interleaving — and
that an ability/item/weather is just another record keyed by `kind`
(`rules.ron:93-121`):

```ron
Effect(id: "status.poison", kind: Status,
    hooks: [ Hook(on: "Residual", order: 10, do: [
        DamageFraction(num: 1, den: 8, of: MaxHp, target: Host) ]) ]),
Effect(id: "item.leftovers", kind: Item,
    hooks: [ Hook(on: "Residual", order: 20, do: [
        HealFraction(num: 1, den: 16, of: MaxHp, target: Host) ]) ]),
Effect(id: "ability.clearbody", kind: Ability,
    hooks: [ Hook(on: "TryBoost", order: 5, do: [
        VetoIf(cond: RelayIntLt(0)) ]) ]),
```

### 3.3 Option A — `interpret()`, keyed by `EffectId`

The loader mints **one distinct `EffectId` per `(effect, event)` hook** and
registers each as its own tiny `Effect` whose `call` is `interpret::<P>`
(`registry.rs:286-308`, `build_effects`, leaking `&'static`). `interpret` matches
`HandlerFn<P>` exactly (`interp.rs:30-56`):

```rust
pub fn interpret<P: RulesProvider>(
    ctx: &mut BattleCtx<'_, P>,
    relay: RelayVar,
    target: BattlerRef,
    source: BattlerRef,
    source_effect: EffectId,
) -> HandlerResult
```

It looks up the compiled hook by `source_effect` (`host.hook(source_effect)`),
applies the `chance` gate (the **sole** rng, `ctx.rng.chance(num, den)`, drawn
**unconditionally** so draw order is a pure function of the op-list), then
`run_ops`. No engine modification is required.

Public API (re-exported from `lib.rs:62-70`): `Ruleset`, `RuleSource`,
`interpret`, `run_ops`, `CompiledRuleset`, `CompiledHook`, `ResolverKind`,
`RulesHost`, `RulesProvider`, `RuleBindings`, plus the model types (`Op`,
`Predicate`, `Selector`, `EffectKind`, `EffectRecord`, `HookRecord`,
`ResourceCost`, `TypeChartEntry`, `Rational`, `FractionOf`, `StatRef`,
`TypeName`, `LoadError`, `parse_event`, `parse_kind`).

### 3.4 Load-time validation — never a battle-time surprise

Every name is bound to the closed vocabulary **at compile** (in
`CompiledRuleset::compile`, `registry.rs:153-265`, + `validate_op`,
`registry.rs:313-370`). An unknown name is a `LoadError`, raised when the ruleset
loads — never mid-battle (`model.rs:37-63`):

```rust
pub enum LoadError {
    Ron(String),
    UnknownEvent(String),
    UnknownType(String),
    BadChance(u32, u32),
    UnknownStatus(String),
    UnknownStat(String),
    UnknownResource(String),
}
```

### 3.5 Dual-mode source-of-truth — baked (release) vs hot-reload (dev)

The **same** `rules.ron` is the single source of truth in two modes
(`source.rs`), and both route through the **same** `Ruleset::from_ron`, so a
baked build and a disk build of the same file produce byte-identical rulesets —
the **baked==disk parity** invariant:

```rust
pub enum RuleSource {
    Baked { text: &'static str },
    Disk {
        path: PathBuf,
        #[cfg(feature = "hot-reload")]
        watcher: Option<watch::Watcher>,
    },
}
```

- **Baked = the DEFAULT (release).** The feature is **off**; the caller passes
  `include_str!`'d text. Zero file IO. `RuleSource::baked(text: &'static str)`
  (`source.rs:57`).
- **Disk = DEV.** `RuleSource::from_path(path: impl Into<PathBuf>)`
  (`source.rs:65`). Behind the `notify`-backed watcher (the cargo feature is
  exactly **`hot-reload`**, `source.rs:136-210`), edits are observed live.
- Both load via `pub fn load(&self) -> Result<Ruleset, LoadError>`
  (`source.rs:81`).
- `RuleSource::poll_changed(&mut self) -> bool` (`source.rs:98`) — a **baked**
  source always returns `false`; a disk source with the feature returns `true`
  when the file changed. There is also `is_hot_reloadable(&self) -> bool`
  (`source.rs:112`).

**Reload-between-turns is safe.** When `poll_changed` returns `true`, the game
re-`load`s and rebuilds the registry **between turns**. This is safe mid-battle
because effects are addressed by `EffectId` and **live state lives in the engine
`EffectState` arena, not in the data** — re-loading swaps the effect *definitions*
without touching live per-instance state (`source.rs:6-14`, `lib.rs:42-51`).

> **This is the path to author moves/abilities/types/costs WITHOUT Rust.** Design
> background: §11
---

## 4. Resources (MP/SP) & move costs

A generic, **P-independent** consumable-resource system lets a move cost MP / SP /
mana / charge. It is fully additive: empty by default, inert by default, and it
consumes **no** randomness.

### 4.1 `ResourcePool` on `BattlerState`

A `ResourcePool` is a `u16`-keyed bag of `(resource_id, current, max)` triples
with **opaque, game-assigned** ids (the engine never learns a resource is "MP").
It defaults **empty** (`battle/mod.rs:137-222`):

```rust
#[derive(Default)]
pub struct ResourcePool {
    entries: Vec<(u16, u16, u16)>,   // (resource_id, current, max)
}
```

Key methods: `new()`, `set(id, current, max)`, `current(id) -> Option<u16>`,
`max(id)`, `can_pay(id, amount) -> bool` (a `0` cost is always payable; a positive
cost on an undeclared id is **not** payable), `pay(id, amount) -> bool`
(saturating, pure arithmetic), `restore`, `len`, `is_empty`.

It is a field on `BattlerState` (`battle/mod.rs:716-737`), initialized to
`ResourcePool::new()` in `BattlerState::new` — so the constructor signature is
**unchanged**:

```rust
pub resources: ResourcePool,
```

with builder/helpers (`battle/mod.rs:773-788`):

```rust
pub fn with_resource(mut self, id: u16, max: u16) -> Self;   // sets current = max
pub fn can_pay_resource(&self, id: u16, amount: u16) -> bool;
pub fn pay_resource(&mut self, id: u16, amount: u16) -> bool;
```

> **Why a `u16`-keyed pool, not `EnumMap<P::Resource>`?** A *defaulted* associated
> type is unstable on stable Rust (`E0658`), so the additive choice is the
> P-independent integer-keyed pool (`battle/mod.rs:580-602` doc; the engine
> assigns the ids no meaning).

### 4.2 The defaulted provider hook

Costs reach the engine through one defaulted `BattleProvider` method
(`battle/mod.rs:600-602`). The default `&[]` makes the gate inert, so all 16
existing `impl BattleProvider` blocks compile unchanged:

```rust
fn move_cost(&self, _move_: &Self::Move) -> &[(u16, u16)] {
    &[]
}
```

### 4.3 The `BeforeMove` cost gate

In `resolve_action`, the gate fires **after** the `BeforeMove` status gate
(`driver.rs:147-150`) and **before** any crit/accuracy/damage draw
(`driver.rs:152-171`):

```rust
let costs = provider.move_cost(&move_);
if !costs.is_empty() {
    let actor_b = ctx.battler(actor);
    if !costs.iter().all(|(id, amt)| actor_b.can_pay_resource(*id, *amt)) {
        return; // cannot pay → move prevented (no rng consumed)
    }
    for (id, amt) in costs {
        ctx.battler_mut(actor).pay_resource(*id, *amt);
    }
}
```

The policy: **cannot pay ⇒ early `return`** (the move is prevented, identical in
shape to a fully-paralyzed `BeforeMove` abort, and the crit/accuracy/damage bytes
are never drawn); **can pay ⇒ deduct**. The whole block is **pure arithmetic** —
it consumes no rng — and with an empty cost / empty pool it is an inert empty
loop, so every existing battle and the stack-parity draw sequence stay
byte-identical.

### 4.4 Authoring a cost in RON

A move declares its cost via the `cost:` field — `Vec<ResourceCost>`, where
`ResourceCost { resource: String, amount: u16 }` (RON `Cost(...)`,
`model.rs:131-153`). The compiler interns each `resource:` name to an id; an
unknown name is `LoadError::UnknownResource` at load (`registry.rs:204`,
`registry.rs:368`). The compiled `move_costs` map
(`CompiledRuleset.move_cost(source_id) -> &[(usize, u16)]`, `registry.rs:108`,
`276-278`) is what a game wires into `BattleProvider::move_cost`. There is also a
`PayResource { resource, amount, target }` op (`model.rs:347-354`, interpreted at
`interp.rs:219-233`: `Fail` if `!bindings.can_pay_resource(...)`, else
`bindings.pay_resource(...)`) for a `BeforeMove` cost expressed as data:

```ron
<!-- not verified: excerpt, not loadable standalone -->
Effect(id: "move.blade", kind: Move, category: "Physical", power: 80, type: "Metal", accuracy: 100,
    cost: [ Cost(resource: "MP", amount: 3) ],
```

with the resource declared once at the top level (`rules.ron:28`):

```ron
resources: ["MP"],
```

### 4.5 minimon's MP example

minimon declares a single resource, `Mp`, mapped to opaque id `0`
(`lib.rs:279-305`):

```rust
pub enum Resource { Mp }
impl Resource { pub const fn id(self) -> u16 { match self { Resource::Mp => 0 } } }
pub const MP: u16 = Resource::Mp.id();

const BLADE_COST:   &[(u16, u16)] = &[(MP, 3)];
const TORRENT_COST: &[(u16, u16)] = &[(MP, 5)];
const NO_COST:      &[(u16, u16)] = &[];
```

`MinimonProvider::move_cost` (`lib.rs:403-412`) hands these back by move id;
Tackle and Ember return `NO_COST`. The asserted outcomes (`tests.rs`):

- `special_move_costs_mp_and_deducts_it` (line 377): 10 MP − BLADE 3 ⇒
  `current(MP) == Some(7)`.
- insufficient MP: 2 MP < BLADE 3 ⇒ the move is prevented, the defender is
  unharmed, and `current(MP) == Some(2)` is unchanged.
- `physical_move_with_no_cost_is_unaffected_by_mp` (line 410): Tackle with 0 MP
  still deals 80 and `current(MP) == Some(0)`.
- `torrent_costs_5_mp_exact_balance_is_payable` (line 427): exactly 5 MP affords
  Torrent ⇒ `current(MP) == Some(0)`.

> **Two distinct policies — do not conflate.** The **engine** gate
> (`driver.rs:163-171`) treats any positive cost on an **undeclared** resource as
> **unpayable** (move prevented). minimon's **native** `pay_move_cost`
> (`lib.rs:1007-1027`) deliberately differs: a battler that does **not** declare
> the resource treats the move as **free** (skips the gate). The asserted minimon
> tests above exercise the native `Battle` path; the `data_mode` flag
> (`lib.rs:404`) makes the native `move_cost` return `NO_COST` so the data driver
> supplies the cost from `rules.ron` instead. Design background: §13
---

## 5. Cookbook: cross-gen mechanics → effect-stack recipes

The one pattern behind every recipe: a mechanic is **never** an engine concept.
It is an `Effect` **hosted on X** (a battler/side/field, wired by a resolver),
whose handlers **subscribe to event(s) Y**, **do Z**, **ordered via `order=N`**.

| Mechanic | Host it on X (resolver) | Subscribe to event(s) Y | In your handler, do Z | Order `N` |
|---|---|---|---|---|
| **Damaging move** | the action (`effect_for_move`) | `ModifyDamage` | Damage comes from your `calculate_damage`; this hook is the move's seam. Scale via `Set(relay.scale(n,d))` for rolls/boosts. | `u32::MAX` |
| **Status-on-hit secondary** | the action (`effect_for_move`) | `DamagingHit` | Roll `ctx.rng.next_u8() < threshold`; on success record intent / fire a `TrySetStatus` via your driver. Side-effecting ⇒ return `Unchanged`. | default |
| **Stat-stage move** | the action (`effect_for_move`) | `DamagingHit` (or post-hit) | Record a boost request; your driver fires `TryBoost` (relay = `Int(delta)`) so vetoes get a vote, then applies the surviving delta to `stat_stages`. | default |
| **Recoil / drain** | the action (`effect_for_move`) | `DamagingHit` | Read `ctx.mv.last_damage`; recoil = `take_damage(last_damage/N)` on `source`; drain = `heal(last_damage/2)` on `source`. | default |
| **Ability: passive stat boost** (Huge Power) | the battler (`effect_for_ability`) | `ModifyStat` | If the relay carries the boosted stat and `target` is the holder, `Set(relay.scale(2,1))`. Folds into the damage-formula stat read. | `ModifyStat`-tier |
| **Ability: immunity** (Levitate / Wonder Guard) | the battler (`effect_for_ability`) | `Effectiveness` (mult) **or** `TryHit` (hard veto) | On `Effectiveness`, `Set(relay.scale(0,1))` to zero it; on `TryHit`, return `Fail`/`FailSilent` to cancel before damage. | low (before damage) |
| **Ability: on-switch-in** (Intimidate) | the battler (`effect_for_ability`) | `SwitchIn` | Handler can't hold `&P`, so **record intent** in `ctx.mv`; your `switch_in` helper (holds `&P`) re-enters and fires the real `TryBoost` where Clear Body can veto. | `10` |
| **Held item: residual heal** (Leftovers) | the battler (`effect_for_item`) | `Residual` (or `SideResidual`/`FieldResidual`) | `heal((max_hp/16).max(1))` on `host`, ordered **after** the status chip. | `20` (chip = `10`) |
| **Held item: damage boost** (Life Orb / Choice Band) | the battler (`effect_for_item`) | `ModifyDamage` (or `ModifyStat` for Choice Band) | If `source` is the holder, `Set(relay.scale(13,10))` (×1.3). | mid |
| **Held item: pinch trigger** (Sitrus / Salac) | the battler (`effect_for_item`) | `DamagingHit` / `AfterMove` | If `ctx.battler(host).hp` fell below ½ max, `heal(...)` / fire a `TryBoost`, then mark consumed in your state. | high (after the hit settles) |
| **Weather: damage mult** (Rain→Water) | the field (`field_effects`) | `ModifyDamage` (+ `WeatherModifyStat` for stat mults) | Inspect move/holder type from `ctx`; `Set(relay.scale(3,2))`. `WeatherModifyStat` layers **after** `ModifyStat`. | `WeatherModifyStat` after `ModifyStat` |
| **Weather: end-of-turn chip** (Sandstorm) | the field (`field_effects`) | `FieldResidual` | For each active `target`, if not immune `take_damage((max_hp/16).max(1))`. Drive with `run_event_checked` so a KO doesn't fire a stale handler. | residual-tier |
| **Entry hazard** (Spikes / Stealth Rock) | the side (`side_effects`) | `SwitchIn` | When a battler enters that side, `take_damage` scaled by a stored layer count (state in your side-hosted struct). | low (on entry) |
| **Multi-turn / locked move** (Thrash / Hyper Beam) | a battler volatile (`effect_for_volatile`) + `forced_action` | volatile listens on `BeforeMove`/`End`; the lock is `forced_action` | A volatile set on a prior turn makes `forced_action(effects, actor, chosen)` return `Some(locked_move)`, hijacking this turn's input. `BeforeMove` gates (recharge skip); `End` fires Thrash self-confuse. | n/a (a seam, not a fold) |
| **Type chart / effectiveness** (相克) | the action (`effect_for_move`) | `Effectiveness` | Recover the move's element from `source_effect`, read defender type(s), fold the chart **product** into ONE rational, `Set(relay.scale(num, den))`. Integer-only; 0× = immune. Stay in the `Damage` lane. See [§2](#2-type-effectiveness-相克--type-charts). | `100` (after `ModifyDamage`) |
| **Resource cost** (MP / SP / mana) | the actor (`move_cost` hook) | gate at `BeforeMove` (engine `StackDriver`) | Return `&[(resource_id, amount)]` from `move_cost`; the gate prevents the move if unpayable, else deducts. Pure arithmetic, no rng, inert with `&[]`. Or in data, a `cost:` field / `PayResource` op. See [§4](#4-resources-mpsp--move-costs). | n/a (a gate, not a fold) |
| **No-code authoring** (moves/abilities/items/types/costs in RON) | the `dotzuki-rules` loader (`interpret` keyed by `EffectId`) | any event a `Hook(on: …)` names | Write an `EffectRecord` in `rules.ron` with hooks whose `do:` is a list of closed primitive `Op`s; the loader registers each as an `Effect` calling `interpret`. Dual-mode baked / hot-reload. See [§3](#3-no-code-authoring-with-rulesron-the-dotzuki-rules-loader). | per-hook `order:` |
| **Non-volatile status residual** (burn / poison chip) | the actor's status (`effect_for_status`) | `Residual` | `take_damage((max_hp/16).max(1))` on `host`; no rng; self-guard a 0-HP host. The driver's per-mover residual fires `effect_for_status` **then** each live volatile's `effect_for_volatile` in arena-id order. Skip the flat chip when a volatile owns the tick (e.g. a badly-poisoned ramp). | `10` (before leech) |
| **Pre-move "cannot act" gate** (sleep / freeze / paralysis / confusion) | a `BeforeMove` hook (in pokered: on every move effect; or aggregate from status/volatile in your driver) | `BeforeMove` | Read the actor's status / volatile; return `Fail` to abort (draw the status's rng byte **only when present**). `run_event` short-circuits on the first `Fail`, so set each gate's `order` to the original draw sequence (e.g. confusion `70` < paralysis `90`). The driver then logs `Blocked` (§2.11) so the frontend can show the reason. | per-status `order` |
| **Turn narration** (battle text / animation) | n/a — call `execute_turn_logged` | — (consumes the `TurnLog`) | Walk the returned `TurnLog<P>` and map each `TurnEvent` to your frontend (a text line, an HP-bar drain, a faint anim). Re-derive presentation game-side (effectiveness wording, the `Blocked` reason). Additive: `execute_turn` is unchanged. See [the design page §2.11](../explanation/effect-stack.md#211-narrating-a-turn--the-turnlog). | n/a |

### Mechanics that need **no engine change at all**

- **Physical/special split.** `calculate_damage` is provider-supplied and stats
  are `EnumMap<P::Stat>`. Define `{Hp,Atk,Def,SpA,SpD,Spe}` and pick the stat
  pair by the move's category. The engine never sees the category. (Proven in
  minimon.)

### Notes on the recipe seams

- `forced_action` is the **locked-move mechanism, not an event** — it returns
  `Some(BattleAction)` to swap the chosen action. The engine names no game-specific
  volatile; all lock semantics live in your impl. (Proven inert-by-default and
  active-when-implemented in the engine tests `forced_action_default_is_inert`
  and `forced_action_overrides_chosen_action`.)
- The on-switch-in re-entry caveat is **real**: `HandlerFn` gives `&mut
  BattleCtx` but **not `&P`**, so a handler **cannot re-enter dispatch** (re-entry
  needs the provider to run resolvers). "An ability fires another vetoable event"
  is therefore a **driver-orchestration** pattern — record intent in the handler,
  fire the sub-event from the driver helper that holds `&P`.
---

## 6. Determinism & testing

Determinism is a first-class property here: the engine draws randomness **only**
through `ctx.rng`, and your game owns the generator, so every outcome is a pure
function of `(initial state, byte script)`.

### Asserting outcomes

Use `ScriptedRng` to pin the exact bytes, then assert on `BattleState`
(Showdown-style hand-derived oracles). minimon's split test:

```rust
let mut phys = Battle::new(MinimonProvider::default(), split_attacker(vec![TACKLE]), split_defender());
phys.fire_move(BattlerRef::PLAYER, &TACKLE);
assert_eq!(100 - phys.battler_ref(BattlerRef::OPPONENT).hp, 80);
```

Ordering proofs lean on the *math being asymmetric* so the order is provable from
the outcome alone. Leftovers: chip-then-heal from full HP yields **94** (100 −
12 + 6); heal-first would be a no-op at full HP then chip → **88**. So `94`
*proves* chip-before-heal:

```rust
// holder is Poisoned and holds Leftovers
b.end_of_turn_residual(BattlerRef::PLAYER);
assert_eq!(b.battler_ref(BattlerRef::PLAYER).hp, 94);   // 88 would mean wrong order
```

### Asserting collection & draw order directly

`collect_handlers` + `compare` let you assert *which* sources were gathered and
in what order, without running the fold:

```rust
let mut hs = Vec::new();
collect_handlers(&ctx, provider, None, Event::TryBoost, BattlerRef::OPPONENT, BattlerRef::PLAYER, &mut hs);
hs.sort_by(dotzuki_engine::battle::stack::compare);
let orders: Vec<u32> = hs.iter().map(|h| h.order).collect();
assert_eq!(orders, vec![5]);                 // Clear Body (order 5) collected on the foe's TryBoost
assert_eq!(hs[0].target, BattlerRef::OPPONENT);   // hosted on the TARGET (cross-battler collection)
```

### Draw-order parity

`ScriptedRng::consumed()` lets you assert the engine drew the bytes you expect in
the order you expect — the credential that pins Gen-1 RNG quirks. The engine's
own tests assert, e.g., that a tied handler run draws **exactly one** byte and a
distinct run draws **zero** (`speed_tiebreak_draws_only_on_tie`), and that crit
is drawn before accuracy (`crit_is_drawn_before_accuracy`). Run the suites:

```bash
cargo test -p dotzuki-engine            # engine: comparator, pair_mut, multi-source, forced_action
cargo test -p minimon                # the 5-system authoring proof + controls
```

---

### See also

- Code: [`examples/minimon/src/lib.rs`](../../examples/minimon/src/lib.rs),
  [`examples/minimon/src/tests.rs`](../../examples/minimon/src/tests.rs),
  [`examples/minimon/rules.ron`](../../examples/minimon/rules.ron),
  [`crates/dotzuki-rules/src/`](../../crates/dotzuki-rules/src/).
