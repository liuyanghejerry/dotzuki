# Battle Engine Generalization — `jrpg-engine::battle::stack` as a Multi-Gen Authoring Surface

**Status:** design + critique-incorporated. Specifies engine work vs example/authoring work. The
existing `battle::stack` module and its slices 1–7 (docs
[06](06-battle-engine-effect-stack-design.md)/[07](07-effect-stack-poc-result.md)/[08](08-effect-stack-migration-status.md))
are the **regression credential** that pattern C works in Rust — they are NOT the deliverable of
this doc.

---

## 0. Reframed goal (this SUPERSEDES the Gen-1-1:1 framing)

The deliverable is **a battle engine a developer can use to BUILD a battle system LIKE Pokémon Red /
FireRed / Gen 4/5/6** — a clean, general authoring surface, *not* a byte-identical Gen-1 clone.

- **Exact Gen-1 parity was a VALIDATION technique, now retired as a goal.** Slices 1–7 proved
  pattern C reproduces ~410 Gen-1 fidelity outcomes (incl. deliberate bugs) under Rust's borrow
  checker with one localized `unsafe` and zero `rand`. That proof stands as a *credential*. We keep
  those slices green as regression tests; we do **not** keep "match the legacy struct byte-for-byte"
  as the design's optimization target.
- **Optimize for GENERALITY + AUTHORING FREEDOM**, not fidelity. The question shifts from "does this
  match `MoveRandoms` field order?" to "can a developer express a Gen-4 ability, a Gen-2 held item, a
  Gen-3 weather, and a physical/special split *without touching engine code* and without
  `if gen==N`?"

**Constraints (unchanged, non-negotiable):**

1. `jrpg-engine` stays **100% game-agnostic** — no Pokémon concrete types (species/move/item/ability
   stay associated types on `BattleProvider`/`EffectProvider`); **no `rand`** (RNG only via the
   `BattleRng` trait).
2. Any **new method on an existing engine trait MUST be defaulted**, so every existing game/test
   compiles unchanged. (Slices 5/6 already proved this discipline: `effect_for_volatile` and
   `forced_action` are defaulted-to-`None` and inert for all other games.)
3. **All game-specific semantics live in the GAME's effect handlers.** The engine never branches on a
   generation, a species, a weather, or an ability name. It dispatches events and folds relays; the
   game's `HandlerFn` pointers contain every rule.

**The key insight that makes this cheap (apply it everywhere below):**

> Under an effect-stack, **abilities and held items are NOT new engine concepts** — they are just
> `Effect`s hosted on a battler that subscribe to events. **Weather and field conditions are
> `Effect`s hosted on a *side* or the *field*.** The **physical/special split is already
> expressible** because `calculate_damage` is provider-supplied and stats are a generic
> `EnumMap<P::Stat>` — the game decides which stat each move reads. So there are exactly **two real
> gaps**, and both are addressable without new engine *concepts*:
>
> 1. a **broader `Event` taxonomy** (the current enum fires only ~8 of the kinds a cross-gen game
>    needs), and
> 2. a **reusable Effect-AUTHORING surface** (today the only `HandlerFn`s that exist live in
>    pokered's `#[cfg(test)]` parity harness — there is no ergonomic, documented way for a developer
>    to write a move/ability/item/weather).

Everything in this doc is either **(E) engine work** — broaden events, broaden handler collection,
add minimal defaulted seams — or **(A) example/authoring work** — the developer-facing builders,
helpers, and a non-pokered proof game. Each section is tagged.

---

## 1. (E) The broadened `Event` taxonomy — final, minimal-yet-sufficient

### 1.1 Design rules

- **Closed enum, no payload.** Keep the current shape (`event.rs`): an `Event` is a dispatch *key*;
  the payload rides in the typed `RelayVar`. A closed enum keeps the comparator reviewable and the
  fold cheap. (The critique's earlier worry — "an open string bus is over-engineering for one game" —
  flips slightly now that generality is the goal, but a closed enum is still correct: cross-gen
  effects all map to a *finite, knowable* set of interaction points; Showdown itself uses a closed
  set. We add an `Event::Custom(u16)` escape hatch — see 1.4 — so a game is never *blocked* by the
  closed set, getting the audit/perf benefits of closed dispatch with an open tail.)
- **Adding a variant is a non-breaking engine change** *iff* no handler is forced to match it
  exhaustively. Handlers subscribe by listing `EventHook { event: Event::X, .. }`; they never
  `match` the whole `Event` enum. The only exhaustive matches are inside the engine driver, which we
  control. So **growing this enum does not break games** — it only offers new subscription points.
- **Minimal-yet-sufficient:** include a kind only if a Gen-1–6 effect genuinely needs a *distinct
  interaction point*. Where the critique showed two design kinds collapse to one fire-point, we cut
  the redundant one (slice 7 already proved this: the design's `AfterMoveSecondary` was never needed
  — secondaries fire through the existing `DamagingHit`).

### 1.2 The taxonomy (final): 6 groups, **31 kinds** — 11 existing, 20 new

Marked **[x] existing** (in `event.rs` today) vs **[+] new (engine work)**. Where the critique cut or
merged a kind from doc 06's §1.1 sketch, it is noted.

**Group A — Turn lifecycle (3): 1 existing, 2 new**
| Kind | E/N | Purpose |
|---|---|---|
| `BeforeTurn` | [x] | after speed-sort settles, before any action |
| `ResidualOrder` | [+] | *renamed clarity over* `BeforeTurn`-adjacent; fires the end-of-turn batch ordering (weather tick → status tick → leftovers → …). Drives Gen-2+ end-of-turn sequence. |
| `AfterTurn` | [+] | post-residual cleanup (Gen-5 form reset, counters) |

**Group B — Action / move pipeline (9): 4 existing, 5 new**
| Kind | E/N | Purpose |
|---|---|---|
| `BeforeMove` | [x] | status gate (sleep/freeze/para/flinch/confusion/recharge/Truant) — veto point |
| `ModifyMove` | [+] | mutate the move in flight (multi-hit count, type override, Normalize ability) |
| `ModifyType` | [+] | per-hit type override (Pixilate/Aerilate, Hidden Power) — split from `ModifyMove` because abilities re-type *after* the move's own type pick |
| `ModifyCritRatio` | [x] | crit threshold fold (Focus Energy, high-crit, Super Luck ability, Razor Claw item) |
| `Accuracy` | [x] | accuracy fold → `0..=255` (1/256 miss; Compound Eyes, Hustle, Sand Veil) |
| `Invulnerability` | [+] | Fly/Dig/Dive/Bounce gate; `fast_exit` veto |
| `ModifyDamage` | [x] | damage scaling fold (rolls, items like Life Orb, weather boost, STAB-via-Adaptability) |
| `Effectiveness` | [+] | type-effectiveness fold (Gen-1 immunity-as-miss; Levitate, Scrappy, Tinted Lens, Wonder Guard) |
| `AfterMove` | [+] | per-action cleanup (Hyper Beam recharge set, Life Orb recoil, Rocky Helmet contact dmg via the contact flag) |

*(Cut from doc 06: `BasePower` merged into `ModifyDamage` — no Gen-1–6 effect needs a fire-point
between "compute base power" and "scale damage" that `ModifyDamage` can't host; `AfterMoveSecondary`
cut — slice 7 proved secondaries ride `DamagingHit`.)*

**Group C — Hit / damage application (5): 2 existing, 3 new**
| Kind | E/N | Purpose |
|---|---|---|
| `TryHit` | [+] | pre-damage interception veto (Substitute swap-target, Protect/Detect, Magic Bounce redirect) |
| `Damage` | [x] | damage-application fold (Substitute absorb, Disguise, Endure/Sturdy floor-to-1) |
| `DamagingHit` | [x] | a hit connected — secondary-effect + reactive fire-point (Counter/Bide read, Static/Flame Body, recoil, drain) |
| `Heal` | [+] | healing fold (Heal Block veto, Big Root item boost) |
| `AfterFaint` | [+] | post-KO (Moxie/Beast Boost ability, Aftermath, Destiny Bond resolution) |

**Group D — Status & stat changes (6): 0 existing, 6 new** *(all engine work)*
| Kind | E/N | Purpose |
|---|---|---|
| `TrySetStatus` | [+] | veto setting a non-volatile status (type immunity, Immunity/Limber ability, Safeguard, Substitute block) |
| `AfterSetStatus` | [+] | status applied (Synchronize ability, Toxic Orb self-status) |
| `TryBoost` | [+] | veto/modify a stat-stage change (Clear Body, Hyper Cutter, White Smoke) |
| `AfterBoost` | [+] | stat change applied (Defiant/Competitive ability) |
| `ModifyStat` | [+] | persistent stat fold for the damage formula reads (Huge Power, Choice Band, para ÷4 speed, burn ÷2 atk) — one fold parameterized by `P::Stat` in the relay |
| `WeatherModifyStat` | [+] | the Gen-2+ weather/ability stat multipliers that must layer *after* `ModifyStat` (Sand Force, Chlorophyll, Swift Swim) |

**Group E — Lifecycle / presence (5): 3 existing, 2 new**
| Kind | E/N | Purpose |
|---|---|---|
| `Start` | [x] | an effect was added to a host (volatile applied; ability/item attached on switch-in) |
| `End` | [x] | an effect removed (volatile expired → Thrash self-confuse; item consumed) |
| `Faint` | [x] | a battler fainted |
| `SwitchIn` | [+] | a battler entered — the cross-gen ability/item/hazard fire-point (Intimidate, Drizzle, Stealth Rock damage, Toxic Spikes) |
| `SwitchOut` | [+] | a battler is leaving (Regenerator, Natural Cure, pursuit interaction, Baton Pass capture) |

**Group F — Field / side (3): 0 existing, 3 new** *(all engine work)*
| Kind | E/N | Purpose |
|---|---|---|
| `SetWeather` | [+] | veto/replace a weather change (Air Lock/Cloud Nine suppress, Damp Rock duration) |
| `FieldResidual` | [+] | field-hosted end-of-turn tick (weather chip damage, Trick Room countdown, terrain) |
| `SideResidual` | [+] | side-hosted end-of-turn tick (Spikes, Wish resolution, Reflect/Light Screen countdown) |

**Plus the escape hatch (1.4): `Custom(u16)`** — not counted in the 31; a game-defined dispatch key
for effects the closed taxonomy doesn't anticipate.

### 1.3 Why this is sufficient across Gen 1–6 (and what it deliberately omits)

The taxonomy covers every *interaction shape* in the structural-bug catalog (doc 06 §6) **plus** the
four cross-gen systems FireRed centralizes as `AbilityBattleEffects` / `ItemBattleEffects` hooks at
*switch-in / end-of-turn / on-hit* (doc 03 line 61) — which map exactly to `SwitchIn` /
`*Residual` / `DamagingHit`+`AfterMove`. Doubles-only redirection (Follow Me, Lightning Rod
target-steal) is expressible via `TryHit` + a defaulted `redirect_target` seam (1.5) but is **not a
goal** here — single-battle Gen 1–6 is the scope; the doubles seam is left present-but-inert, same
discipline as slices 5/6.

### 1.4 `Event::Custom(u16)` — the open tail (E)

```rust
pub enum Event {
    BeforeTurn, ResidualOrder, AfterTurn,
    BeforeMove, ModifyMove, ModifyType, ModifyCritRatio, Accuracy,
    Invulnerability, ModifyDamage, Effectiveness, AfterMove,
    TryHit, Damage, DamagingHit, Heal, AfterFaint,
    TrySetStatus, AfterSetStatus, TryBoost, AfterBoost, ModifyStat, WeatherModifyStat,
    Start, End, Faint, SwitchIn, SwitchOut,
    SetWeather, FieldResidual, SideResidual,
    /// Game-defined dispatch key. The engine dispatches it like any other event
    /// (collect → sort → fold) but assigns it no built-in meaning — the game's
    /// driver extension fires it. Lets a game add an interaction point WITHOUT an
    /// engine change, at the cost of the closed-set audit guarantee for that key.
    Custom(u16),
}
```

`Custom` keeps the closed-enum benefits (cheap `Copy`/`Hash`, exhaustive driver matches with one
`Event::Custom(_) => ..` arm) while guaranteeing a developer is **never blocked**. This is the
generality concession the reframed goal demands and the original Gen-1-only design rejected.

---

## 2. (E) Broadening handler collection — and how it stays borrow-safe

### 2.1 The collection gap today

`dispatch::collect_from_effect` (current code) collects hooks from **one effect the driver explicitly
passes** (the move's effect, or the host's status effect). That was correct for the Gen-1 slices: no
Gen-1 effect listens on *another* effect's event. But a cross-gen battle has **many simultaneous live
effects that must all get a chance to subscribe to one event**: when a move hits, the attacker's
*ability* (Sheer Force), the attacker's *item* (Life Orb), the defender's *ability* (Static), the
defender's *item* (Rocky Helmet), the *weather* (Sand chip), and the *field* (Grassy Terrain heal)
all want the same `DamagingHit` / `Residual`. The engine must **gather from every relevant source**.

### 2.2 The broadened collector (E)

Replace the single-effect collect with a **multi-source gather** that walks, for a given event +
target + source:

1. the **source effect** (the move/volatile that triggered the dispatch),
2. every **live volatile** on `target` and on `source` (the arena, via `effect_for_volatile`),
3. each battler's **ability** and **held item** (new defaulted resolvers, 2.4),
4. the **side** effects of `target.side` and `source.side` (screens, hazards, Wish),
5. the **field** effects (weather, terrain, Trick Room),

collecting each source's matching hooks **plus** the synthesized prefix variants
(`OnAny`/`OnFoe`/`OnSource`/`OnAlly`) so an effect on battler X can listen to an event *targeting*
battler Y (Static reacting to being hit; Intimidate on the foe's switch-in). The prefix synthesis was
present-but-inert in the slices; **this is the slice that turns it on**.

```rust
pub fn collect_handlers<P: EffectProvider + ?Sized>(
    ctx: &BattleCtx<'_, P>, provider: &P,
    ev: Event, target: BattlerRef, source: BattlerRef,
    out: &mut Vec<CollectedHandler<P>>,
) {
    // 1. source effect (resolved by caller, as today)
    // 2. volatiles on target & source (arena scan → effect_for_volatile)
    for e in ctx.effects.iter().filter(|e| e.host == target || e.host == source) {
        if let Some(eff) = provider.effect_for_volatile(&e.kind) {
            push_matching(ctx, eff, ev, target, source, out); // direct + OnFoe/OnSource prefixes
        }
    }
    // 3. ability + held item on each relevant battler  (defaulted resolvers → None ⇒ skipped)
    for who in [target, source] {
        if let Some(eff) = provider.effect_for_ability(ctx.battler(who)) { push_matching(..) }
        if let Some(eff) = provider.effect_for_item(ctx.battler(who))    { push_matching(..) }
    }
    // 4./5. side + field effects (defaulted resolvers → empty ⇒ skipped)
    for eff in provider.side_effects(ctx, target.side).chain(provider.side_effects(ctx, source.side)) { .. }
    for eff in provider.field_effects(ctx) { .. }
}
```

Every resolver in steps 3–5 **defaults to `None`/empty** (2.4), so for a game with no
abilities/items/weather (or for the existing Gen-1 slices) the broadened collector reduces *exactly*
to today's behavior — zero new bytes drawn, zero behavioral change. **This is how broadening stays
non-breaking.**

### 2.3 The ONE borrow-safety risk, and how it's handled

**Risk:** the broadened gather reads `ctx.battler(who)` (to resolve ability/item) and reads
`ctx.effects` (the arena) **while building `out`**, and then `run_event` *folds* handlers that each
take `&mut BattleCtx` — i.e. each handler can **add/remove effects, faint a battler, or mutate the
very arena/battlers the collector walked**. A naïve "iterate the arena and call handlers inline"
aliases `&ctx.effects` (the iterator) with `&mut ctx` (the handler) — the classic
iterator-invalidation + mutable-aliasing bug, and the place a cross-gen stack most easily reaches for
`RefCell`.

**How it's handled (no `RefCell`, preserves the slices' borrow proof):** the **collect-then-fold
split is the invariant** — already true in `run_event` today, now made load-bearing for multi-source:

1. **Collect fully into an owned `Vec<CollectedHandler>` first**, taking only `&BattleCtx` (shared).
   `CollectedHandler` stores the **`HandlerFn` pointer + `EffectId` + `BattlerRef`s by value** — *no
   borrows into the arena or battlers*. Once collected, the snapshot is independent of `ctx`.
2. **Then fold**, the loop owning `hs` and handing each handler `&mut BattleCtx`. A handler that adds
   an effect pushes into `ctx.effects`; that addition **does not retroactively join the current
   fold** (it's a snapshot) — it takes effect on the *next* dispatch. This matches Showdown's "events
   collected at fire time" semantics and is the documented behavior in dispatch.rs.
3. **Dynamic liveness re-check inside the fold** (the one addition over today): because a handler
   earlier in the fold can faint `h.target` or remove `h.source_effect`, each iteration re-checks
   `is_alive(ctx, h.target)` and `ctx.effect(h.source_effect).is_some()` and **skips stale handlers**
   — rather than calling into a removed effect's state. This is a *read* re-check between calls, while
   the loop holds the sole `&mut`, so it never aliases.

```rust
for h in hs {                                   // hs owned; independent of ctx
    if !is_alive(ctx, h.target) { continue; }   // re-check: a prior handler may have KO'd it
    if ctx.effect(h.source_effect).is_none()
        && needs_live_state(h) { continue; }    // re-check: source effect may have been removed
    match (h.call)(ctx, relay, h.target, h.source, h.source_effect) { /* fold */ }
}
```

The borrow argument is unchanged from the slices' GO verdict: handlers receive `&mut BattleCtx`,
**never** borrowed battler/effect refs; the snapshot decouples collection from mutation; `pair_mut`
remains the only cross-battler `&mut`+`&mut` path (still one localized cross-side `unsafe`, still
`split_at_mut` same-side). Multi-source collection adds **read fan-out**, not new aliasing — the
hazard is iterator-invalidation, and the snapshot eliminates it by construction.

### 2.4 The defaulted resolver seams collection needs (E)

All added to `EffectProvider`, **all defaulted to `None`/empty** (constraint 2):

```rust
fn effect_for_ability(&self, b: &BattlerState<Self>) -> Option<&'static Effect<Self>> { None }
fn effect_for_item(&self,    b: &BattlerState<Self>) -> Option<&'static Effect<Self>> { None }
fn side_effects (&self, ctx: &BattleCtx<Self>, side: u8) -> &[&'static Effect<Self>] { &[] }
fn field_effects(&self, ctx: &BattleCtx<Self>)          -> &[&'static Effect<Self>] { &[] }
```

`BattlerState<P>` already carries `ability: P::Ability` and a moves/status surface; the game's
resolver maps that opaque id to a `&'static Effect`. The engine never reads the ability's *meaning* —
it only fetches the hook table. **This is the whole "abilities = effects" mechanism: a resolver + a
collection pass. No new engine enum, no `Ability` concept beyond the associated type that already
exists** (`BattleProvider::Ability`, mod.rs:400).

---

## 3. (E/A) Abilities, items, weather, field as Effects — no new engine enums

The unifying claim, stated precisely:

> Every "system" a cross-gen battle adds is an `Effect` (`&'static [EventHook]`) hosted somewhere,
> resolved by a defaulted provider seam, gathered by the broadened collector (§2), and fired through
> the same `run_event` fold. The engine gains **events and resolvers**, never a `Weather` rules
> engine or an `Ability` dispatcher.

| System | Hosted on | Resolver (defaulted seam) | Primary events it subscribes to | New engine *concept*? |
|---|---|---|---|---|
| Move effect | the action | `effect_for_move` *(exists)* | `ModifyDamage`, `DamagingHit`, `Effectiveness`, `BeforeMove` | none |
| Volatile (Substitute, Bide, Thrash) | a battler (arena) | `effect_for_volatile` *(exists, slice 5)* | `Damage`, `Residual`, `BeforeMove`, `End` | none |
| Non-volatile status (burn, poison) | a battler | `effect_for_status` *(exists)* | `Residual`, `ModifyStat`, `BeforeMove` | none |
| **Ability** (Intimidate, Static, Levitate) | a battler | `effect_for_ability` **[+]** | `SwitchIn`, `DamagingHit`, `Effectiveness`, `TryBoost` | **none** |
| **Held item** (Leftovers, Life Orb, Choice Band) | a battler | `effect_for_item` **[+]** | `Residual`, `ModifyDamage`, `ModifyStat`, `End` | **none** |
| **Weather** (Rain, Sand) | the field | `field_effects` **[+]** | `FieldResidual`, `ModifyDamage`, `WeatherModifyStat` | **none** |
| **Field/Terrain/Trick Room** | the field | `field_effects` **[+]** | `FieldResidual`, `ModifyStat`, `ModifyMove` | **none** |
| **Side condition** (Spikes, Reflect, Wish) | a side | `side_effects` **[+]** | `SwitchIn`, `SideResidual`, `ModifyDamage` | **none** |

### 3.1 Minimal defaulted **state seams** these need (E)

The arena `EffectState` already homes battler-hosted volatile state. Cross-gen adds **side-hosted and
field-hosted** state. Rather than new arenas, generalize the arena's `host` addressing:

```rust
// extend the existing BattlerRef-keyed host to a 3-way scope (engine work, additive)
pub enum EffectHost { Battler(BattlerRef), Side(u8), Field }
// EffectState.host: BattlerRef   →   EffectState.host: EffectHost
```

This is the **one slightly-invasive engine change** (it widens an existing field's type). To keep
constraint 2, ship it as a **new `EffectState2` with `host: EffectHost`** *or* (preferred) make
`host` an `Into<EffectHost>`-fed field with a `From<BattlerRef>` so existing constructors compile
unchanged. Weather duration, screen counters, Wish payload, hazard layer-count all live as
`P::EffectStateKind` variants on a `Side`/`Field`-hosted `EffectState` — **the game supplies the
variants; the engine stamps `effect_order` and routes by host, exactly as for battler volatiles
today.** No `Weather`/`Terrain` *rules* enter the engine (the existing `Weather`/`Terrain` value
types in mod.rs stay as inert UI-projection data or are demoted).

### 3.2 What's engine vs authoring here

- **(E)** `EffectHost` widening; the four defaulted resolvers (§2.4); the new events (§1).
- **(A)** every actual ability/item/weather `Effect` const + its `HandlerFn`s, and the game's
  resolver impls — all in the example game crate, never in `jrpg-engine`.

---

## 4. (A) The developer Effect-authoring surface

**The real second gap.** Today a `HandlerFn` is a free `fn` with a 5-arg signature, and the only ones
that exist are buried in pokered's `#[cfg(test)]` parity harness. A developer building a new game has
**no ergonomic, documented way to author an effect.** This section is **authoring/example work** (it
can ship as helpers in a thin `jrpg-engine::battle::stack::authoring` module that adds *no new engine
concept* — just constructors and typed relay accessors — plus templates in the example game).

### 4.1 The authoring helpers (thin, engine-side but concept-free)

```rust
// stack::authoring — ergonomic constructors over the existing EventHook/Effect.
// Zero new runtime concept: these BUILD the same &'static [EventHook] the engine folds.

/// Declarative effect builder used in a `const`/`static` context.
macro_rules! effect {
    ($id:expr, $kind:expr, { $( $ev:ident $( ($ord:expr) )? => $fn:path ),* $(,)? }) => {
        Effect { id: $id, kind: $kind, hooks: &[ $(
            EventHook { event: Event::$ev, call: $fn,
                        order: effect!(@ord $($ord)?), priority: 0, sub_order: None },
        )* ] }
    };
    (@ord $o:expr) => { $o }; (@ord) => { u32::MAX };
}

/// Typed relay accessors so handlers don't hand-match RelayVar.
impl RelayVar {
    pub fn as_int(self) -> i64 { if let RelayVar::Int(v)=self {v} else {0} }
    pub fn as_damage(self) -> u16 { if let RelayVar::Damage(v)=self {v} else {0} }
    pub fn scale(self, num: u32, den: u32) -> RelayVar { /* fold-friendly multiply, min-1 opt */ }
}
```

### 4.2 Real authored examples (all **(A)**, all in the game crate, all `&'static`)

**(a) A move — Flamethrower (10% burn secondary):**
```rust
fn flamethrower_hit<P: EffectProvider>(ctx: &mut BattleCtx<P>, _r: RelayVar,
    tgt: BattlerRef, src: BattlerRef, _e: EffectId) -> HandlerResult {
    // secondary draws its byte LAST per mover (draw-order contract, doc 08 §2)
    if ctx.rng.next_u8() < 26 {                      // 10% ≈ 26/256
        try_set_status(ctx, tgt, src, MyStatus::Burn); // fires TrySetStatus → AfterSetStatus
    }
    HandlerResult::Unchanged                          // DamagingHit is side-effecting
}
const FLAMETHROWER: Effect<MyGame> =
    effect!(EffectId(0x10), EffectType::Move, { DamagingHit => flamethrower_hit });
```

**(b) An ability — Intimidate (drop foe Attack one stage on switch-in):**
```rust
fn intimidate_switch_in<P: EffectProvider>(ctx: &mut BattleCtx<P>, _r: RelayVar,
    _tgt: BattlerRef, src: BattlerRef, _e: EffectId) -> HandlerResult {
    let foe = opposite_active(src);
    try_boost(ctx, foe, MyStat::Attack, -1);          // routes through TryBoost (Clear Body can veto)
    HandlerResult::Unchanged
}
// hosted on the battler; resolved by effect_for_ability; listens via the OnSource-self SwitchIn.
const INTIMIDATE: Effect<MyGame> =
    effect!(EffectId(0xA1), EffectType::Condition, { SwitchIn => intimidate_switch_in });
```

**(c) A held item — Leftovers (heal 1/16 max HP each end-of-turn):**
```rust
fn leftovers_residual<P: EffectProvider>(ctx: &mut BattleCtx<P>, _r: RelayVar,
    host: BattlerRef, _src: BattlerRef, _e: EffectId) -> HandlerResult {
    let max = ctx.battler(host).max_hp;
    heal(ctx, host, (max / 16).max(1));               // routes through Heal (Heal Block can veto)
    HandlerResult::Unchanged
}
const LEFTOVERS: Effect<MyGame> =
    effect!(EffectId(0xB1), EffectType::Condition, { Residual(20) => leftovers_residual });
//                                                            └ order:20 → after status chip (order:10)
```

**(d) Weather — Sandstorm (chip non-Rock/Ground/Steel 1/16; boost SpD of Rock):**
```rust
fn sand_field_residual<P: EffectProvider>(ctx: &mut BattleCtx<P>, _r: RelayVar,
    _t: BattlerRef, _s: BattlerRef, _e: EffectId) -> HandlerResult {
    for who in active_battlers(ctx) {
        if !sand_immune(ctx.battler(who)) {
            let max = ctx.battler(who).max_hp; damage(ctx, who, (max/16).max(1));
        }
    }
    HandlerResult::Unchanged
}
fn sand_spd_boost<P: EffectProvider>(ctx: &mut BattleCtx<P>, r: RelayVar,
    tgt: BattlerRef, _s: BattlerRef, _e: EffectId) -> HandlerResult {
    if is_rock(ctx.battler(tgt)) { return HandlerResult::Set(r.scale(3, 2)); } // ×1.5 SpD
    HandlerResult::Unchanged
}
// FIELD-hosted (host: EffectHost::Field); resolved by field_effects.
const SANDSTORM: Effect<MyGame> = effect!(EffectId(0xF1), EffectType::Condition, {
    FieldResidual       => sand_field_residual,   // chip
    WeatherModifyStat   => sand_spd_boost,        // layered after ModifyStat
});
```

Every example is a `const`, zero-capture `fn`s, no engine edit, no `if gen==N`. **This is the
"freedom" deliverable:** a developer expresses Gen-1 burn, a Gen-4 ability, a Gen-2 item, and a Gen-3
weather with the same four-line pattern, differing only in *which event they subscribe to* and *what
their handler does*.

---

## 5. (Confirmation) The physical/special split needs **no engine change**

The Gen-1→Gen-4 physical/special split — the canonical "big mechanical change" — requires **zero
engine work**, by inspection of the existing trait surface:

- `BattlerState<P>` stores **`stats: EnumMap<P::Stat, u16>`** (mod.rs:573). `P::Stat` is a *game*
  associated type. A Gen-1 game defines `Stat::{Hp,Atk,Def,Spe,Spc}`; a Gen-4 game defines
  `Stat::{Hp,Atk,Def,Spe,SpA,SpD}`. **The split is a different `P::Stat` enum — invisible to the
  engine**, which only ever indexes the map by an opaque key.
- **`calculate_damage(move, attacker, defender, random, is_critical) -> DamageResult`** (mod.rs:416)
  is **provider-supplied**. The game's formula decides, per move, whether to read `Atk/Def` or
  `SpA/SpD` (Gen-4: by a per-move physical/special flag; Gen-1: by the move's *type*). The engine
  passes whole `BattlerState`s and gets a number back — it never knows which stats were read.
- Persistent stat modifiers that differ by split (burn halves *physical* Atk only; Choice Band boosts
  *physical*) ride the **`ModifyStat` event** (§1.2 group D), folded by stat key in the relay — again
  parameterized by `P::Stat`, no engine branch.

So the split is **already expressible** today; the broadened events only make the *modifier* layering
(weather/ability/item stat multipliers) ergonomic via `ModifyStat`/`WeatherModifyStat`. **No new
engine method, no defaulted seam, nothing.** This confirms the key insight and is worth stating
plainly so no one re-litigates it as "engine work."

---

## 6. (A) The CROSS-GEN PROOF — smallest non-pokered example, exact scope, go/no-go

The slices proved pattern C against **pokered's Gen-1 oracle**. That proves *fidelity*, not
*generality* — it cannot show a developer can author a Gen-4-shaped system, because pokered has no
abilities/items/weather and is the very game we're generalizing *away* from as the target. **The
cross-gen proof is a NEW, tiny, second game** that exercises the broadened taxonomy + authoring
surface, with **no Gen-1 parity oracle** (there is none for abilities) — its oracle is
*hand-specified expected `BattleState` outcomes*, the same way Showdown unit-tests an ability.

### 6.1 Exact scope (and ONLY this)

A `#[cfg(test)]` mock game **`minimon`** (in the engine crate's tests, or a `examples/minimon` crate)
with a `P::Stat` of the **6-stat Gen-4 shape** (proving the split) and **one of each system**, each a
single authored `Effect`:

1. **One physical move + one special move** reading different stats via `calculate_damage` — proves
   §5 (the split) with a real, distinct outcome (physical move scaled by Atk/Def, special by
   SpA/SpD).
2. **One ability — Intimidate** (§4.2b): on `SwitchIn`, drops the foe's Atk one stage → next physical
   move deals less. Proves `SwitchIn` + `effect_for_ability` + `TryBoost` + the prefix-synthesis
   cross-battler collection (§2.2).
3. **One ability veto — Clear Body** on the foe: vetoes Intimidate's `TryBoost` → Atk unchanged.
   Proves the veto gate + multi-source collection ordering (both abilities fire on one `TryBoost`).
4. **One held item — Leftovers** (§4.2c): `Residual` heal, ordered *after* a status chip via `order`.
   Proves `effect_for_item` + residual ordering across two *different-source* effects (the one case
   the `speed`/`order` comparator tiers exist for).
5. **One weather — Sandstorm** (§4.2d): `FieldResidual` chip + `WeatherModifyStat` SpD boost.
   Proves field-hosted state (`EffectHost::Field`), `field_effects`, and the
   `ModifyStat`→`WeatherModifyStat` layering order.

That is **5 systems, ~6 authored `Effect`s, ~10 handler fns** — small enough to read in one sitting,
broad enough that it touches every new engine seam (§2.4 resolvers, §3.1 `EffectHost`, the new
events). It deliberately does **not** include: doubles, multi-hit, a full move table, AI, or any
pokered code. It does **not** chase byte-parity — its assertions are hand-written expected outcomes.

### 6.2 Go / No-Go

| Axis | GO | NO-GO (re-open the design) |
|---|---|---|
| **Authoring** | each of the 5 systems is expressed as a `const Effect` + zero-capture `fn`s using the §4 helpers, with **no engine edit** beyond the §2.4 defaulted resolvers + §1 events + §3.1 `EffectHost` | authoring a single ability/item/weather requires a new *non-defaulted* engine method, a closure-capturing handler, or an `if gen`/`if ability==` branch in the engine |
| **Agnosticism** | `jrpg-engine` still links **no `rand`** and contains **no `minimon`/Pokémon concrete type** outside `#[cfg(test)]`; the new events/resolvers name nothing game-specific | any concrete game type or `rand` leaks into engine non-test code |
| **Non-breaking** | the existing Gen-1 slices (88 stack-parity tests) + `jrpg-engine` (301) + `pokered-core` (1907) stay **green unchanged** — proving every new event/resolver/`EffectHost` change is additive+defaulted | any pre-existing test needs editing to compile/pass ⇒ a seam wasn't defaulted |
| **Borrow** | multi-source `collect_handlers` + the fold compile with the §2.3 snapshot+re-check strategy, **no `RefCell`/`Rc`**, only the existing one cross-side `unsafe` | multi-source collection forces interior mutability or a second `unsafe` |
| **Generality** | Intimidate, Clear Body's veto, Leftovers' ordering, and Sandstorm's chip+boost all produce the hand-specified outcomes, with abilities on *both* battlers firing on one event in comparator order | a cross-gen interaction (cross-battler ability react, field-hosted residual, stat-fold layering) can't be expressed without an engine special-case |

**A NO-GO on Authoring or Borrow is the kill signal** for "this taxonomy + collection model is the
right generalization"; a NO-GO on Non-breaking means a seam needs re-defaulting; everything else is
tuning.

---

## 7. Engine work vs example/authoring work — the ledger

| Item | E (engine) / A (authoring) | Defaulted / non-breaking? |
|---|---|---|
| Broaden `Event` (11→31 + `Custom`) — §1 | **E** | Yes — adding variants doesn't force any handler match |
| Multi-source `collect_handlers` + prefix synthesis + fold liveness re-check — §2.2/2.3 | **E** | Yes — reduces to today's behavior when resolvers are default |
| `effect_for_ability` / `effect_for_item` / `side_effects` / `field_effects` — §2.4 | **E** | Yes — all default `None`/empty |
| `EffectHost` widening (battler→side→field) — §3.1 | **E** | Yes — via `From<BattlerRef>`, existing constructors compile |
| `redirect_target` doubles seam — §1.3 | **E** | Yes — defaulted, inert, not a goal |
| `stack::authoring` helpers (`effect!` macro, typed `RelayVar` accessors) — §4.1 | **E (concept-free)** | Yes — pure constructors over existing types |
| Physical/special split | **neither** | No change needed — §5 |
| Actual ability/item/weather/move `Effect`s + handlers + resolver impls | **A** | n/a (game crate) |
| `minimon` cross-gen proof game + its outcome assertions — §6 | **A** | n/a (test/example) |
| Keeping the 88 Gen-1 stack-parity slices green | **regression credential** | Must stay unchanged |

**Net engine surface added:** ~20 event variants + `Custom`, 4 defaulted resolvers, 1 widened host
type (via `From`), 1 inert doubles seam, and concept-free authoring helpers. **Every one is
additive+defaulted** — the slices' GO verdict (borrow-sound, deterministic, agnostic) is preserved by
construction, and the *deliverable* becomes generality + a clean authoring surface, with Gen-1 parity
demoted to a regression credential.
