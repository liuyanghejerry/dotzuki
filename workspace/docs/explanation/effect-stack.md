# The effect-stack battle engine

This page explains the design of `dotzuki_engine::battle::stack` — the
Showdown-style effect-stack battle engine: its execution model, its
event/effect/handler architecture, RNG determinism, and the limits of the
current design.

> - **Audience**: battle authors, engine contributors
> - **Type**: explanation
> - **Status**: active
> - **Last verified**: v0.1.0

> **Scope.** This page covers the design of **`dotzuki_engine::battle::stack`** —
> the Showdown-style **effect-stack** battle engine — and why it is shaped the
> way it is. The authoring half — declaring events, effects, and handlers,
> writing `rules.ron`, the minimon walkthrough, type charts, resource costs, and
> testing — lives in [`how-to/battles.md`](../how-to/battles.md).
>
> The battle stack is a **separate topic** from the broader engine guide
> ([`archive/developer-guide-legacy.md`](../archive/developer-guide-legacy.md)),
> which covers maps, NPCs, scripting, rendering, menus, items, and save. That
> guide predates the battle stack and its §6 ("战斗与怪物系统") describes only the
> *legacy* `battle::driver`/`BattleProvider` path — it does **not** cover
> `battle::stack`. Read it for everything outside battle; read this page and
> the battles how-to for battle.
>
> Design background: §06
> (the stack design), §09
> (the generalization design), §10
> (the GO-WITH-NITS result).

---

## Table of contents

1. [Overview & mental model](#1-overview--mental-model)
2. [Core concepts](#2-core-concepts)
3. [Honest limits & roadmap](#3-honest-limits--roadmap)

---

## 1. Overview & mental model

The battle stack is an **effect-stack** engine in the style of Showdown
(it is *pattern C*: native-Rust **zero-capture `fn`-pointer** handlers, **not** a
scripting VM). One sentence holds the whole design:

> **Everything is an `Effect` that subscribes to `Event`s. The engine sequences
> the events and folds the handlers; your handlers decide what happens.**

There is **no `Ability` system, no `Item` system, no weather system, no
hazard system** inside the engine. Each of those is *just an `Effect` hosted
somewhere* (on a battler, a side, or the field) that registers handlers for the
events it cares about. The engine reaches them through **defaulted resolver
methods** you implement on a provider trait — nothing more.

The consequence: the **physical/special split** — usually a structural battle
decision — needs **zero engine changes**. Stats are a generic
`EnumMap<P::Stat, u16>` keyed by *your* opaque stat enum, and the damage formula
lives in *your* `calculate_damage`. A Gen-1 game keys `{Hp,Atk,Def,Spe,Spc}`; a
split game keys `{Hp,Atk,Def,SpA,SpD,Spe}` and picks the stat pair by the move's
category. The engine never sees the category — it hands you whole battler states
and takes a number back.

### What lives where

```
dotzuki_engine::battle::stack         the effect-stack engine (game-AGNOSTIC)
├── event       Event enum, RelayVar, HandlerResult, Effect/EventHook, HandlerFn
├── ctx         EffectProvider (the trait you implement), BattleCtx, EffectState,
│               EffectHost, MoveContext
├── dispatch    collect_handlers, compare, run_event / run_event_checked
├── driver      StackDriver (a built-in turn sequence), FirstMover, StackTurnResult
└── authoring   the `effect!` macro

dotzuki_engine::battle                BattleProvider (supertrait), BattleState,
│                                  BattlerState, BattlerRef, BattleAction, EnumMap
└── rng         BattleRng trait, ScriptedRng

examples/minimon                   the canonical "how a developer uses this"
```

The flow of one dispatch:

```
your driver code             the engine                       your handlers
─────────────────            ─────────────────                ──────────────
collect_handlers(...)  ──►    walk EVERY live source           (a snapshot of
                             (source effect + both              fn-pointers, by value)
                              battlers' ability/item/
                              volatile/status + side + field)
run_event(ctx, hs, relay) ─► sort by comparePriority,
                             RNG-permute only the ties,
                             then FOLD:
                               for each handler:        ──►    fn(ctx, relay, ...)
                                 relay = handler(relay)         -> HandlerResult
                             return the final relay
```

Your handlers **only** touch the battle through `&mut BattleCtx`; they cannot
capture or alias state. Re-entrancy (a handler that wants to fire another event)
is done by your *driver code* (which holds the provider), not inside a handler —
see [§2.9](#29-the-provider-resolvers-you-implement) and
[the Intimidate recipe](../how-to/battles.md#5-cookbook-cross-gen-mechanics--effect-stack-recipes).
---

## 2. Core concepts

### 2.1 The `Event` taxonomy — what fires, and when

Events are a **closed enum of keys with no payload** (the payload rides in a
typed [`RelayVar`](#relayvar--the-typed-fold-payload)). A closed enum (not a
string-keyed bus) keeps the comparator and the parity tests auditable; the open
tail `Event::Custom(u16)` is the escape hatch so a game is never *blocked*.

The taxonomy is 31 named kinds in 6 groups, plus the legacy `Residual`, plus
`Custom`. **Important:** the engine's built-in `StackDriver` today only *fires* a
subset; the rest are present as **subscription seams** — inert until a driver
extension fires them. You can fire any of them yourself from your own driver code
via `collect_handlers` + `run_event` (that is exactly what minimon does for
`SwitchIn`, `TryBoost`, `FieldResidual`, `WeatherModifyStat`).

```rust
pub enum Event {
    // ── Group A — Turn lifecycle ──
    BeforeTurn, ResidualOrder, AfterTurn,

    // ── Group B — Action / move pipeline ──
    BeforeMove,        // pre-move status gate (sleep/freeze/para/flinch/recharge) — the veto point
    ModifyMove,        // mutate the move in flight (multi-hit count, Normalize)
    ModifyType,        // per-hit type override (Pixilate/Aerilate)
    ModifyCritRatio,   // crit-threshold fold; CRIT IS DRAWN HERE — before Accuracy
    Accuracy,          // accuracy fold (the Gen-1 1/256 miss)
    Invulnerability,   // Fly/Dig gate
    ModifyDamage,      // final-damage fold (the damage roll; Life Orb, weather, STAB)
    Effectiveness,     // type-effectiveness fold (Levitate, Wonder Guard)
    AfterMove,         // per-action cleanup (Hyper Beam recharge set, Life Orb recoil)

    // ── Group C — Hit / damage application ──
    TryHit,            // pre-damage veto/redirect (Protect, Substitute, Magic Bounce)
    Damage,            // damage-application fold (Substitute absorb, Sturdy floor-to-1)
    DamagingHit,       // a hit connected — secondaries, Counter/Bide read, recoil, drain
    Heal,              // healing fold (Heal Block veto, Big Root)
    AfterFaint,        // post-KO (Moxie, Aftermath, Destiny Bond)

    // ── Group D — Status & stat changes ──
    TrySetStatus,      // veto a non-volatile status (Immunity, Safeguard)
    AfterSetStatus,    // status applied (Synchronize, Toxic Orb)
    TryBoost,          // veto/modify a stat-stage change (Clear Body, Hyper Cutter)
    AfterBoost,        // stat change applied (Defiant)
    ModifyStat,        // persistent stat fold for damage-formula reads (Huge Power, burn ÷2 atk)
    WeatherModifyStat, // weather/ability stat mults that layer AFTER ModifyStat (Swift Swim)

    // ── Group E — Lifecycle / presence ──
    Start, End, Faint,
    SwitchIn,          // a battler entered — Intimidate, Drizzle, Stealth Rock damage
    SwitchOut,         // a battler is leaving — Regenerator, Natural Cure, Baton Pass

    // ── Group F — Field / side ──
    SetWeather,        // veto/replace a weather change (Air Lock)
    FieldResidual,     // field-hosted end-of-turn tick (weather chip, Trick Room countdown)
    SideResidual,      // side-hosted end-of-turn tick (Spikes, Wish, screen countdown)
    OnMiss,            // accuracy-miss reaction (fired by StackDriver's miss branch; Jump Kick crash)

    // ── Legacy (kept for the Gen-1 regression slices) ──
    Residual,          // PER-MOVER end-of-action residual (burn/psn → leech)

    // ── The open tail ──
    Custom(u16),       // a game-defined dispatch key the engine assigns no meaning
}
```

> **`Residual` vs `FieldResidual`/`SideResidual`.** The §1.4 taxonomy folds the
> per-mover `Residual` into `ResidualOrder`/`FieldResidual`/`SideResidual`, but
> the 88 Gen-1 stack-parity slices fire `Residual` directly, so it is kept as an
> existing variant (the additive/non-breaking constraint trumps the rename).
> minimon uses the legacy `Residual` for its item/status-chip ordering recipe and
> `FieldResidual` for Sandstorm. New games may prefer the §1.4 kinds.

Driver firing invariant you must respect if you reproduce Gen-1: in the built-in
`StackDriver`, **`ModifyCritRatio` MUST fire before `Accuracy`** so the crit byte
is drawn before the accuracy byte (matching the original `MoveRandoms` field
order). This ordering is pinned by a standing draw-order guard
(`crit_is_drawn_before_accuracy`); do not swap them in a custom driver if you
want Gen-1 fidelity. See `driver.rs:155-167`.

### 2.2 `Effect` / `EventHook` — registering handlers

An `Effect` is an id + a category + a `'static` sparse table of hooks. Because
the table is `'static`, registrations are zero-alloc `const`/`static`s.

```rust
pub struct Effect<P>   { pub id: EffectId, pub kind: EffectType, pub hooks: &'static [EventHook<P>] }
pub struct EventHook<P>{ pub event: Event, pub call: HandlerFn<P>,
                         pub order: u32, pub priority: i32, pub sub_order: Option<u8> }

pub struct EffectId(pub u32);                  // opaque arena key, you assign these
pub enum   EffectType { Move, Status, Condition }
// EffectType::sub_order() defaults: Condition = 2, Status = 4, Move = 6
```

The ergonomic way to author one is the **`effect!` macro** (re-exported at the
crate root as `dotzuki_engine::effect`):

```rust
// Syntax: effect!(<id expr>, <EffectType expr>, { <Event> [(<order>)] => <fn path>, ... })
//   - <Event> is BARE (e.g. DamagingHit) — the macro qualifies it.
//   - (<order>) is optional; omitted ⇒ order = u32::MAX (fires LAST).
//   - priority defaults to 0, sub_order defaults to None (derive from EffectType).

pub static LEFTOVERS: Effect<MinimonProvider> = effect!(EffectId(0xB1), EffectType::Condition, {
    Residual(20) => leftovers_residual::<MinimonProvider>,
});
```

You can also write the struct literal by hand when you want explicit `priority`
or `sub_order` (the macro always uses `priority: 0, sub_order: None`):

```rust
pub static INTIMIDATE: Effect<MinimonProvider> = Effect {
    id: EffectId(0xA1),
    kind: EffectType::Condition,
    hooks: &[EventHook {
        event: Event::SwitchIn,
        call: intimidate_switch_in::<MinimonProvider>,
        order: 10, priority: 0, sub_order: None,
    }],
};
```

### 2.3 The handler signature + `HandlerResult` + `RelayVar` fold

A handler is a **zero-capture `fn` pointer**. Its only mutable path into the
battle is `ctx`; everything else it receives by value.

```rust
pub type HandlerFn<P> = fn(
    ctx: &mut BattleCtx<'_, P>,   // the ONLY mutable path into the battle
    relay: RelayVar,              // the typed fold value in flight
    target: BattlerRef,          // event target
    source: BattlerRef,          // event source
    source_effect: EffectId,     // which Effect registered this handler
) -> HandlerResult;
```

A handler returns a verdict that mirrors Showdown's `undefined / value / false /
null`:

| Variant | Meaning | Effect on the fold |
|---|---|---|
| `Unchanged` | relay passes through, continue | Showdown `undefined` |
| `Set(RelayVar)` | relay becomes this, continue (or return if `fast_exit`) | Showdown returns a value |
| `Fail` | STOP, "but it failed!" | the fold returns `RelayVar::Bool(false)` |
| `FailSilent` | STOP, no message | the fold returns `RelayVar::Unit` |

#### `RelayVar` — the typed fold payload

Events carry no payload; it rides in `RelayVar`:

```rust
pub enum RelayVar { Unit, Int(i64), Damage(u16), Accuracy(u8), Bool(bool) }
```

Typed accessors are **lossy** (the wrong lane yields `0`/`false`), and `scale` is
the `×num/den` modifier shape that keeps the relay in its lane (and guards `/0`
via `den.max(1)`):

```rust
fn as_int(self) -> i64;        fn as_damage(self) -> u16;
fn as_accuracy(self) -> u8;    fn as_bool(self) -> bool;
fn scale(self, num: u32, den: u32) -> RelayVar;   // e.g. ×1.5 == relay.scale(3, 2)
```

A handler that contributes a ×1.5 boost just returns `Set(relay.scale(3, 2))`; a
veto returns `Fail`; an observer that only side-effects (residual chip, recoil)
mutates through `ctx` and returns `Unchanged`.

### 2.4 Ordering — `order` / `priority` and the comparePriority knobs

When you fold, `run_event` sorts the collected handlers by this **exact** lexical
order, then RNG-permutes only the tied runs:

```
order  →  priority  →  speed  →  sub_order  →  effect_order
asc        desc        desc      asc            asc
(LOW 1st)  (HIGH 1st)  (HIGH)    (LOW 1st)      (LOW 1st)
```

What you control per `EventHook`:

- **`order`** (`u32`, default `u32::MAX` = fires last) — the **primary,
  cross-source** ordering knob. This is the one you reach for most. minimon's
  poison chip at `Residual(10)` vs Leftovers heal at `Residual(20)` makes
  chip-before-heal hold across two *different* effect sources (a status effect
  and an item effect collected on one dispatch).
- **`priority`** (`i32`, default `0`, HIGH first) — a secondary bracket within
  equal `order`.
- **`sub_order`** (`Option<u8>`, `None` ⇒ derive from the `EffectType`).

Engine-controlled tiers:

- **`speed`** is currently always `0` (the engine cannot name a "speed" stat from
  the opaque `P::Stat`). If you need a speed tier, you sequence it yourself in
  your driver (e.g. iterate battlers fastest-first).
- **`effect_order`** is the arena creation counter, falling back to the
  effect `id` for moves/abilities/items with no arena entry.
- Exact ties are broken by **one RNG byte per adjacent pair** (`< 128` flip) — the
  only handler-order randomness (`speed_sort_tiebreak`, `dispatch.rs:241`).

### 2.5 The handler context `BattleCtx`

The split-borrow handle handed to every handler. Public fields:

```rust
pub struct BattleCtx<'a, P> {
    pub state:   &'a mut BattleState<P>,        // the two party Vecs
    pub effects: &'a mut Vec<EffectState<P>>,   // the per-effect-instance arena, sorted by id
    pub mv:      &'a mut MoveContext,           // per-move scratch
    pub rng:     &'a mut dyn BattleRng,         // the ONLY randomness source
}
```

Accessors:

```rust
fn battler(&self, r: BattlerRef)            -> &BattlerState<P>;
fn battler_mut(&mut self, r: BattlerRef)    -> &mut BattlerState<P>;
fn pair_mut(&mut self, a, b: BattlerRef) -> (&mut BattlerState<P>, &mut BattlerState<P>); // two disjoint refs
fn effect(&self, id: EffectId)              -> Option<&EffectState<P>>;      // binary search
fn effect_mut(&mut self, id: EffectId)      -> Option<&mut EffectState<P>>;
```

`pair_mut` is the engine's sole hot-path `unsafe`: cross-side refs index two
different `Vec`s (provably disjoint) so it returns two raw-pointer-derived
`&mut`; same-side it uses a safe `split_at_mut`. It `debug_assert!`s `a != b`.
This is the borrow-checker trick that lets a Counter-shaped handler **mutate
`target` while reading `source`** with no `RefCell`/`Rc`.

`BattlerState` exposes `hp: u16`, `max_hp: u16`, `stats: EnumMap<P::Stat, u16>`,
`stat_stages: EnumMap<P::Stat, i8>`, `status: Option<P::Status>`, plus
`take_damage(amount)` and `heal(amount)`.

### 2.6 `MoveContext` — per-move scratch

```rust
pub struct MoveContext {
    pub is_critical: bool,   // whether the in-flight move is a crit
    pub damage: u16,         // the rolled/precomputed damage the driver applies
    pub move_missed: bool,   // whether it missed
    pub last_damage: u16,    // the last damage actually dealt (the canonical Counter/Bide read)
}
```

This is the scratch shared across one move's event chain. The built-in driver
precomputes damage into `mv.damage`, then `ModifyDamage` handlers fold it, then
the driver applies it and writes `mv.last_damage` before firing `DamagingHit`
(`driver.rs:173-188`). Recoil/drain handlers on `DamagingHit` read
`ctx.mv.last_damage`.

### 2.7 The `EffectState` arena + `EffectHost`

A live effect's mutable per-instance state lives in an **arena** (`Vec<EffectState<P>>`,
kept sorted by id for binary search):

```rust
pub struct EffectState<P> {
    pub id: EffectId,                    // arena key
    pub host: BattlerRef,                // the battler this effect is attached to
    pub effect_order: u64,               // monotonic creation tiebreak (RNG-free)
    pub kind: P::EffectStateKind,        // YOUR typed per-effect counter enum
}
impl EffectState<P> { fn host_scope(&self) -> EffectHost; }
```

`P::EffectStateKind` is your game's typed counter enum (e.g. a Toxic counter, a
Substitute hp value, a multi-turn lock counter). The compiler checks every
counter — there is no positional slot bag. Read/write it through
`ctx.effect_mut(id)`:

```rust
if let Some(es) = ctx.effect_mut(EffectId(7)) {
    if let MyKind::Toxic { counter } = &mut es.kind { *counter = counter.saturating_add(1); }
}
```

`EffectHost` is the 3-way scope the engine routes by:

```rust
pub enum EffectHost { Battler(BattlerRef), Side(u8) /* 0=player,1=opponent */, Field }
```

**Important non-breaking detail:** `EffectState.host` stays `BattlerRef` (so every
existing Gen-1 slice's struct literal compiles verbatim), and arena state is
**always battler-hosted today** — `host_scope()` returns
`EffectHost::Battler`. Side- and field-hosted state is *not* stored in the arena;
it lives in **your game**, and you surface its effects through the
`side_effects`/`field_effects` resolvers (see [§2.9](#29-the-provider-resolvers-you-implement)).
`From<BattlerRef>` and `PartialEq` cross-impls let routing code treat a
`BattlerRef` and an `EffectHost::Battler` interchangeably.

### 2.8 `BattleRng` — the only randomness, and determinism

The engine links **no** rng crate. All randomness flows through the `BattleRng`
trait, so *your game* owns the generator and therefore the **exact draw order**
(essential for Gen-1 quirks).

```rust
pub trait BattleRng {
    fn next_u8(&mut self) -> u8;                               // required, the 8-bit primitive
    fn range(&mut self, bound: u32) -> u32 { /* defaulted */ } // override for exact modulo bias
    fn chance(&mut self, num: u32, den: u32) -> bool { /* defaulted: range(den) < num */ }
}
```

For tests, `ScriptedRng::new(bytes)` replays a fixed byte script (repeating the
last byte after exhaustion) and exposes `consumed() -> usize` for draw-order
parity assertions.

### 2.9 The provider resolvers you implement

You implement **`EffectProvider`** (which extends `BattleProvider`). This is the
entire "abilities/items/weather/side-conditions are just Effects" mechanism: a
set of resolvers + the collection pass. There is **no `Ability` dispatcher**.

```rust
pub trait EffectProvider: BattleProvider + 'static {
    type EffectStateKind: Clone;   // your typed per-effect counter enum

    // ── Required ──
    fn effect_for_move  (&self, m: &Self::Move)   -> Option<&'static Effect<Self>>;
    fn effect_for_status(&self, s: &Self::Status) -> Option<&'static Effect<Self>>;
    fn turn_order_rank(&self, state: &BattleState<Self>, who: BattlerRef,
                       action: &Self::Move) -> (i32, i32);   // RNG-FREE; lower acts first

    // ── Defaulted to None/empty → the broadened collector reduces to single-source ──
    fn effect_for_volatile(&self, kind: &Self::EffectStateKind) -> Option<&'static Effect<Self>> { None }
    fn effect_for_ability (&self, b: &BattlerState<Self>)       -> Option<&'static Effect<Self>> { None }
    fn effect_for_item    (&self, b: &BattlerState<Self>)       -> Option<&'static Effect<Self>> { None }
    fn side_effects (&self, ctx: &BattleCtx<'_, Self>, side: u8) -> &[&'static Effect<Self>] { &[] }
    fn field_effects(&self, ctx: &BattleCtx<'_, Self>)          -> &[&'static Effect<Self>] { &[] }

    // ── Cross-turn lock-in (Thrash/Hyper Beam/Fly): swap one action for another ──
    fn forced_action(&self, effects: &[EffectState<Self>], actor: BattlerRef,
                     chosen: &BattleAction<Self>) -> Option<BattleAction<Self>> { None }
}
```

Because all five collection resolvers default to `None`/`&[]`, a game with no
abilities/items/weather/side-conditions sees the broadened collector reduce
**exactly** to single-source behavior — zero new handlers, zero behavioral
change, identical `consumed()` draw order. You light up a system by implementing
its resolver.

`BattleProvider` (the supertrait) binds the associated types
`Monster / Move / Ability / Status / Stat / Species / Type / Item` and owns the
damage formula:

```rust
fn calculate_damage(&self, move_: &Self::Move, attacker: &BattlerState<Self>,
                    defender: &BattlerState<Self>, random: u8, is_critical: bool) -> DamageResult;
// DamageResult { damage: u16, effectiveness: f32, is_miss: bool }
```

**This is where the physical/special split lives** — no engine change required.

### 2.10 Dispatch primitives (what your driver calls)

```rust
// Gather hooks subscribing to `ev` from EVERY live source into an owned snapshot:
//   1. the source effect (the move/volatile that triggered the dispatch)
//   2. live volatiles on target & source (arena scan → effect_for_volatile)
//   3. each relevant battler's ability + item (effect_for_ability / effect_for_item)
//   4. both sides' side_effects
//   5. field_effects
fn collect_handlers<P>(ctx: &BattleCtx<P>, provider: &P, src_eff: Option<&'static Effect<P>>,
                       ev: Event, target: BattlerRef, source: BattlerRef,
                       out: &mut Vec<CollectedHandler<P>>);

// Sort by compare, RNG-permute ties, then fold the relay through each handler:
fn run_event<P>(ctx: &mut BattleCtx<P>, hs: Vec<CollectedHandler<P>>, relay: RelayVar,
                fast_exit: bool) -> RelayVar;
fn run_event_checked<P>(...) -> RelayVar;   // + a per-step liveness re-check (skip a dead target)
fn compare<P>(a, b: &CollectedHandler<P>) -> Ordering;
```

- `collect_handlers` takes only `&BattleCtx` (shared) and fills an **owned** `Vec`
  of `CollectedHandler` (fn-pointer + ids + `BattlerRef`s by value). No borrow
  into the arena survives into the fold — this is the collect-then-fold borrow
  discipline that makes zero-capture handlers and re-entrant dispatch coexist
  without `RefCell`.
- `fast_exit: true` returns on the first `Set` (the redirection / first-blood
  shape, e.g. `TryHit` target redirect).
- Use `run_event_checked` when a fold can KO a later handler's target (e.g.
  multi-target weather chip): it re-reads `hp > 0` before each call and skips a
  dead target. Plain `run_event` does **not** re-check.

### 2.11 Narrating a turn — the `TurnLog`

`StackDriver::execute_turn` returns only `StackTurnResult { first,
second_cancelled }` — enough to *sequence* a turn, not to *narrate* it. A frontend
that renders a battle (text, HP-bar drain, faint animation) needs to know **what
happened**. That is `execute_turn_logged`:

```rust
let (result, log): (StackTurnResult, TurnLog<P>) =
    StackDriver::execute_turn_logged(provider, state, effects, actions, rng);
for ev in &log.events { /* … render … */ }
```

`TurnLog<P>` is an ordered `Vec<TurnEvent<P>>`. The vocabulary is the universal
JRPG turn surface, keyed by the engine's existing generic associated types
(`P::Move` / `P::Status` / `P::Stat`) + `BattlerRef`:

```rust
pub enum TurnEvent<P: EffectProvider + ?Sized> {
    MoveUsed   { actor: BattlerRef, move_: P::Move },   // passed the gate + cost → executes
    Missed     { actor: BattlerRef },                   // accuracy / immunity miss
    Blocked    { actor: BattlerRef },                   // PREVENTED before it ran (see below)
    Crit       { actor: BattlerRef },                   // landed a critical hit
    Damaged    { target: BattlerRef, amount: u16, cause: Option<HpChangeCause<P>> },
    Healed     { target: BattlerRef, amount: u16, cause: Option<HpChangeCause<P>> },
    StatusInflicted { target: BattlerRef, status: P::Status },
    StatusCured     { target: BattlerRef, status: P::Status },
    StatChanged     { target: BattlerRef, stat: P::Stat, delta: i8 },
    Fainted    { who: BattlerRef },
}
```

**It is ADDITIVE + DEFAULTED.** `execute_turn` is `execute_turn_logged` with the
log discarded; the no-log path observes nothing and is **byte-identical** (same
`rng` draw order, same final `BattleState`, same `StackTurnResult`). The log is
recorded by a structural **snapshot + diff** at the driver's existing event sites —
the engine never changes a turn to log it.

Two design rules that keep the engine game-agnostic:

- **The engine reports STRUCTURAL truth; the game supplies PRESENTATION.** The log
  carries the damage *amount* but not the effectiveness *category* ("super
  effective") — that is a game concept (some games have no type chart), so the
  frontend re-derives it from the move's type vs the defender's types
  ([battles how-to §2](../how-to/battles.md#2-type-effectiveness-相克--type-charts)).
  Same for wording, animation choice, and language.
- **`Blocked` is generic.** When a `BeforeMove` gate aborts a move (asleep / frozen
  / fully paralyzed / a confusion self-hit) or the actor can't pay its cost
  (see [battles how-to §4.3](../how-to/battles.md#43-the-beforemove-cost-gate)), the
  driver logs `Blocked { actor }` and **no `MoveUsed`**. The engine
  reports only *that* the move was prevented; the game derives the *reason*
  ("is fast asleep!") from the actor's status / volatiles. This is the event that
  lets a frontend show the "can't move" line a turn would otherwise be silent
  about.

A game-side **translator** turns the log into whatever the frontend consumes (text
lines, an animation queue). See the
[battles how-to §5](../how-to/battles.md#5-cookbook-cross-gen-mechanics--effect-stack-recipes) for
the recipe; the pokered case study lives in the pokered game repository
(post-split) rather than in this repo.
---

## 3. Honest limits & roadmap

**Proven** — single-battle (1v1), authored end-to-end in `examples/minimon` with
**zero `dotzuki-engine` edits** beyond the additive/defaulted seams; verdict
**GO-WITH-NITS** in

- The physical/special split (provider `calculate_damage` + `P::Stat`).
- An ability on `SwitchIn` (Intimidate) and an ability **veto** on `TryBoost`
  (Clear Body) — both abilities, hosted on *different* battlers, collected on
  **one** dispatch in comparator order.
- A held-item residual ordered **after** a status chip via `order` (cross-source
  residual ordering — the case the `order` tier exists for).
- Field-hosted weather (Sandstorm) with `FieldResidual` chip **and**
  `ModifyStat → WeatherModifyStat` stat-fold layering, on `EffectHost::Field`.
- Borrow safety: collect-then-fold owned snapshot + per-step liveness re-check,
  **no `RefCell`/`Rc`**, exactly **one** `unsafe` (the cross-side `pair_mut`). The
  88 Gen-1 parity slices stay green unchanged (additivity proven).

**DONE since the original GO-WITH-NITS** (each additive, each byte-identical when
inert; all three authored end-to-end in minimon and proven by parity tests):

- **Type effectiveness / type charts.** ✅ The `Effectiveness` fold is now *fired*
  in the move path (`driver.rs:206-208` + minimon `fire_move`); an integer
  `RelayVar::scale` rational composes with provider damage. Authored natively (a
  const chart + handler) **or** as RON `type_chart:` data (`ApplyTypeChart`).
  Outcomes `(160, 80, 40, 0)` asserted. See
  [battles how-to §2](../how-to/battles.md#2-type-effectiveness-相克--type-charts)
  and §12
- **No-code RON authoring (dual-mode).** ✅ The `dotzuki-rules` loader parses
  `rules.ron` into runtime `Effect`s via a single `interpret()` keyed by
  `EffectId` (Option A, zero engine change) over a closed primitive-op vocabulary,
  with load-time validation and a **baked (`include_str!`, release) /
  hot-reload-from-disk (the `hot-reload` cargo feature, dev)** source-of-truth that
  guarantees baked==disk parity and safe reload-between-turns. See
  [battles how-to §3](../how-to/battles.md#3-no-code-authoring-with-rulesron-the-dotzuki-rules-loader)
  and §11
- **MP / resources & move costs.** ✅ A P-independent `u16`-keyed `ResourcePool`
  on `BattlerState`, a defaulted `BattleProvider::move_cost` hook, and a
  `BeforeMove` cost gate (cannot pay ⇒ move prevented, else deduct; consumes no
  rng; inert with empty cost/pool), plus a RON `cost:` field + `PayResource`
  primitive + `LoadError::UnknownResource`. See
  [battles how-to §4](../how-to/battles.md#4-resources-mpsp--move-costs)
  and §13
- **Turn narration — the `TurnLog`.** ✅ `StackDriver::execute_turn_logged` returns
  a generic `TurnLog<P>` of `TurnEvent`s (move used / miss / **blocked** / crit /
  damage / heal / status / stat-change / faint) for a frontend to render. Additive
  + defaulted: `execute_turn` is the no-log path and is byte-identical (recorded by
  a structural snapshot+diff at the existing event sites). The engine reports
  structural truth; the game re-derives presentation. See
  [§2.11](#211-narrating-a-turn--the-turnlog); the pokered case study lives in
  the pokered game repository (post-split).

**Still pending** (data model gaps, not regressions):

- **Nested-veto primitive.** The Intimidate ↔ Clear Body vetoable cascade is still
  **driver orchestration** (record intent → driver fires the sub-`TryBoost`); it is
  not yet expressible purely in data. The RON `Boost`/`VetoIf` ops apply directly;
  the nested `TryBoost`/`TrySetStatus` cascade between two records is not a
  primitive (doc 11 §3, Phase 2).
- **Novel per-effect counter state.** Effects with their own running counter
  (Counter / Bide / Substitute hp) need typed `EffectStateKind` arena state, which
  the RON vocabulary does not yet mint — they remain native-Rust effects.
- **Doubles / grid.** A different battle model (multi-target, redirection);
  unchanged from below.

**Documented nit (not a kill signal).** `HandlerFn` gives `&mut BattleCtx` but
**not `&P`**, so a handler **cannot re-enter dispatch**. "An ability fires another
vetoable event" is a **driver-orchestration** pattern (record intent → driver
fires the sub-event). Design §09 §4.2b's `try_boost(ctx, …)`-from-inside-a-handler
sketch is optimistic on this point; see the "one nit" in §10.

**Follow-up — explicitly out of scope, NOT regressions** (per §10):

- **Doubles / multi-target.** A `redirect_target` seam exists but is **defaulted,
  inert, and unproven**; minimon is 1v1. Follow Me / Lightning Rod redirection
  (`TryHit` + redirect) is expressible-in-principle, not exercised.
- **Full content tables / multi-hit / accuracy / crit RNG.** minimon authors **2
  moves** with a deterministic `power*atk/def` formula (no rolls) so outcomes are
  hand-checkable. `Accuracy`, `ModifyCritRatio`, `ModifyMove` (multi-hit), and
  many Group D/E/F events are present as **subscription seams** but not yet fired
  by a shipped driver.
- **Wiring into pokered's production loop is staged, not done.** Gen-1 fidelity
  remains a **regression credential** (the 88 slices via the legacy
  `battle::driver`), not a production swap on the new stack. AI, switching policy,
  and RNG-driven secondaries are not yet exercised on the stack.
- **`EffectHost` is additive, not a widened field.** `EffectState.host` stays
  `BattlerRef` (so all Gen-1 slices compile verbatim); side/field state is
  addressed via the `Side`/`Field` cases + the `side_effects`/`field_effects`
  resolvers, which the game owns. Design §09 §3.1's "widen the field via `From`"
  did **not** hold (Rust field-init ignores `From`) — see the NO-GO note in
  `ctx.rs`.

---

### See also

- [`archive/developer-guide-legacy.md`](../archive/developer-guide-legacy.md) —
  the broader engine guide (maps, NPCs, scripting, rendering, menus, items,
  save). Its §6 covers the *legacy* battle driver, not this stack.
- Code: [`crates/dotzuki-engine/src/battle/stack/`](../../crates/dotzuki-engine/src/battle/stack/),
  [`crates/dotzuki-engine/src/battle/rng.rs`](../../crates/dotzuki-engine/src/battle/rng.rs).
