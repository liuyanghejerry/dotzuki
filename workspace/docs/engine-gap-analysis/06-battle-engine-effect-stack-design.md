# Battle Engine — Effect-Stack Re-founding (Pattern C) — Design & De-Risk

**Status:** design + de-risk pass only. **Nothing in the working tree changes except this file.**
This supersedes the earlier sketch `06-effect-stack-design.md`; it incorporates the adversarial
critique's corrections (RNG-shape shim, typed effect state, same-side split-borrow body, honest
parity oracle, comparator scoping).

**Decision (already made):** re-found the `jrpg-engine` battle system on a **Showdown-style
event/effect-stack** (pattern C). Effects — moves, statuses, abilities, items, field conditions —
**subscribe to events**; handlers stay **native Rust**. This is **explicitly NOT a bytecode VM**
(pattern D): no mini-language, no interpreter, no opcode table.

**Lean:** exact Gen-1 fidelity + determinism **first** (preserve pokered's RNG draw order and the
deliberate bugs), generality second. For a strangler against ~410 fidelity tests, fidelity-first is
the only defensible lean; generality (abilities/items-in-battle/doubles) is a layered extension that
the architecture *admits* but the POC does not build.

---

## 0. Decision & rationale: Pattern C, not Pattern D

| | **C — native effect-stack (CHOSEN)** | **D — bytecode VM (rejected)** |
|---|---|---|
| Handlers | Rust `fn`s subscribing to events | opcodes interpreted at runtime |
| Determinism | RNG drawn at fixed call sites in native code; trivially auditable | RNG drawn from inside the interpreter; draw order is an emergent property of the bytecode + the VM loop — far harder to pin to pokered's struct field order |
| Gen-1 bug fidelity | each bug is a normal Rust handler (e.g. `crit / 4`); the type checker and existing tests cover it | each bug is data in a bytecode blob; no compiler help, parity drift invisible until a test fails |
| Borrow checker | the hard part, but solvable with indices + `&mut BattleCtx` + relay fold (§3) | sidesteps borrows by making everything VM-internal — at the cost of an interpreter and a serialization format |
| Debuggability | step into a handler in a Rust debugger; stack traces are real | step into an interpreter dispatch loop; one level removed |
| Cost to build | medium (event bus + comparator + dispatch) | high (define an ISA, an assembler/loader, a VM, *and* re-encode 82 move effects) |
| When D wins | hot-reloadable / user-authored effects without recompiling; sandboxing untrusted effect code | — neither is a requirement here |

**Why C beats D in Rust specifically.** (1) Rust's value is the borrow checker + zero-cost native
dispatch; a VM throws both away and reintroduces an unchecked indirection layer exactly where
fidelity matters most. (2) Determinism is our hardest constraint (§4); native handlers draw RNG at
*visible source positions* we can line up against pokered's `MoveRandoms` struct, whereas a VM hides
draw order behind interpreter control flow. (3) We already have ~13k LOC of correct native handlers
(`pokered-core::battle`); pattern C *re-homes* that logic into handlers, pattern D would require
*re-encoding* all of it into a new language for zero fidelity benefit. (4) We have no
hot-reload/sandbox requirement — the only thing a VM buys — so its entire cost is dead weight.

The project already has scripting (Boa/JS for **map events**, `jrpg-engine-script`). Battles are
deliberately *not* routed through it: per-frame battle math through a JS bridge would wreck both
determinism and performance. Pattern C keeps battle logic native; pattern D would be a second,
worse scripting layer competing with the one we have.

---

## 1. Architecture — the Rust event model

### 1.1 The `Event` enum (closed taxonomy)

Events are an enum of *dispatch kinds* (the key — no payload); the payload rides in a typed
`RelayVar` threaded through the fold. **Closed enum, not an open string-keyed bus**: Gen-1's quirks
(§6) demand exact, auditable ordering and pinnable RNG fire-order; a closed taxonomy makes the
comparator and the parity tests reviewable. For "pokered + maybe one more game" this is the right
trade — an open bus is over-engineering. Every kind maps 1:1 to a pokered call site.

```rust
// crates/jrpg-engine/src/battle/stack/event.rs
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Event {
    BeforeTurn,                                   // after speed-sort settled
    // ---- per-move pipeline (pokered move_execution.rs:44-138; DRAW ORDER pinned in §4) ----
    BeforeMove,                                   // status gate: sleep→freeze→trap→flinch→recharge
                                                  //   →disable-ctr→confusion→disable→para (bug #12)
    ModifyMove, ModifyType,                       // multi-hit count, type override
    ModifyCritRatio,                              // Focus Energy /4 (#1), high-crit ×8 (#3)
    Accuracy, ModifyAccuracy,                     // returns 0..=255 INT; 1/256 miss (#2)
    Invulnerability,                              // Fly/Dig (#15) gate; fast_exit
    ModifyAtk, ModifyDef, ModifySpA, ModifySpD, ModifySpe,   // stat folds (para ÷4 = ModifySpe #11)
    BasePower, Effectiveness, ModifyDamage,       // type chart → miss (#4); stat /4 overflow (#5)
    Damage, DamagingHit,                          // absorbed by Substitute (#28); Bide/Counter read
    Hit, AfterHit,                                // secondary effects (#23/#24)
    TrySetStatus, AfterStatus, TryBoost, AfterBoost,
    AfterMoveSecondary, AfterMove,                // Hyper Beam recharge (#14)
    Residual,                                     // PER-MOVER end (burn/psn/toxic → leech, #6/#7)
    SwitchIn, Start, End, Faint, AfterFaint,      // lifecycle; Start/End add/remove volatiles
    ModifyWeather,                                // field (inert in gen-1; kept for generality)
}
```

`Modify*` events are **numeric folds** (each handler scales/returns a number). `Try*` events are
**veto gates** (a handler returns `Fail`/`FailSilent` to abort). Lifecycle events
(`Start`/`End`/`Residual`/`SwitchIn`/`Faint`) are **side-effecting** (relay passes through).

### 1.2 Handler signature

A handler receives split mutable access to the battle (`&mut BattleCtx`, §3), the threaded `relay`,
the `target`/`source` battler handles, and the `source_effect` (which effect triggered this run — so
a handler knows "this damage came from move X"). It returns a fold verdict mirroring Showdown's
`undefined / value / false / null`:

```rust
pub enum RelayVar { Unit, Int(i64), Damage(u16), Accuracy(u8), Effectiveness(i32), Bool(bool) }

pub enum HandlerResult {
    Unchanged,        // relay passes through untouched, continue          (Showdown `undefined`)
    Set(RelayVar),    // becomes new relay, continue                       (Showdown returns a value)
    Fail,             // relay→falsy: STOP, show "but it failed!"          (Showdown `false`)
    FailSilent,       // relay→falsy: STOP, no message                     (Showdown `null`)
}

pub type HandlerFn<P> = fn(
    ctx: &mut BattleCtx<'_, P>,
    relay: RelayVar,
    target: BattlerRef,        // existing engine type: { side: u8, slot: u8 } (mod.rs:243)
    source: BattlerRef,
    source_effect: EffectId,
) -> HandlerResult;
```

Handlers are **zero-capture `fn` pointers**, not closures. This is a deliberate determinism +
borrow win: a `fn` cannot capture and alias battle state, so the only mutable path is through
`ctx`. The cost (per-effect counter state must live in data, not a closure) is paid in
`EffectState` (§3.1) — the critique flagged this; we address it with a **typed** state enum, not a
positional slot bag.

### 1.3 Registration, ordering, tie-break

Each `Effect` declares hooks. `find_event_handlers` collects, from every live effect on the
relevant battlers/sides/field, its `on<Event>` callback **plus** synthesized prefixed variants
(`OnAny`/`OnFoe`/`OnSource`/`OnAlly`) so one effect can listen on another's events. Each collected
handler is wrapped and sorted by the **exact** Showdown `comparePriority` lexical order —
**order → priority → speed → sub_order → effect_order**:

```rust
pub struct CollectedHandler<P> {
    order: u32,        // on<Event>Order; default u32::MAX (fires last);    LOW first
    priority: i32,     // on<Event>Priority;                                HIGH first
    speed: u32,        // battler current speed stat;                       HIGH first
    sub_order: u8,     // effectType table (Cond 2, Weather 5, Ability 7, Item 8); LOW first
    effect_order: u64, // monotonic creation counter (Battle-wide);         LOW first  ← final tiebreak
    target: BattlerRef, source: BattlerRef, source_effect: EffectId, call: HandlerFn<P>,
}
fn compare<P>(a: &CollectedHandler<P>, b: &CollectedHandler<P>) -> Ordering {
    a.order.cmp(&b.order)
        .then(b.priority.cmp(&a.priority))
        .then(b.speed.cmp(&a.speed))
        .then(a.sub_order.cmp(&b.sub_order))
        .then(a.effect_order.cmp(&b.effect_order))
}
```

`effect_order` is a `u64` counter on the battle, stamped into each `EffectState` at creation — the
**final deterministic tiebreaker** so identical effects fire in creation order, *without* consuming
RNG. **Speed ties** (`speed_sort`): selection sort; when two entries `compare == Equal`, draw one
byte from `BattleRng` to permute *only* the tied run — the single source of true turn-order
randomness, mirroring pokered's `order_random` coin flip (`turn_order.rs:40`, bug #22).

**Scoping note (critique).** Ship the *full* comparator and `EventHook` fields, but for Gen-1
**only wire the fields Gen-1 exercises**: `order` (residual/status ordering), `speed`+speed-tie,
`effect_order`. Leave `sub_order` defaulting from the effect-type table and the
`OnAny/OnFoe/OnSource/OnAlly` prefix synthesis present-but-inert (no gen-1 effect registers a
prefixed hook) until a second game (abilities/items/doubles) needs them. Do not build the doubles
machinery now; do not delete the seams.

### 1.4 The action queue

A `BattleQueue` mirrors Showdown's, reusing the existing `BattleAction<P>` vocabulary
(`Fight/Switch/UseItem/Run/Nothing`, `mod.rs:289`) and `OrderKey` (`mod.rs:281`):

```rust
pub struct BattleQueue<P> { pub list: Vec<QueuedAction<P>>, }
pub struct QueuedAction<P> {
    pub action: BattleAction<P>,
    pub actor: BattlerRef,
    pub order: u32,            // coarse tier (megaEvo/switch/move/residual)
    pub priority: i32,         // move priority (Quick Attack +1 #21, Counter -1 #20)
    pub speed: u32, pub effect_order: u64,
}
impl<P> BattleQueue<P> {
    pub fn insert_choice(&mut self, a: QueuedAction<P>);   // binary-insert via compare, NO full re-sort
    pub fn resolve_action(&mut self, a: BattleAction<P>) -> SmallVec<[QueuedAction<P>; 2]>; // 1 → ≥1
    pub fn sort(&mut self, rng: &mut dyn BattleRng);       // full speed_sort at start of turn
}
```

Critically, **a handler may push new actions** during execution (faint→switch-in, residual batch,
forced moves). Gen-1 multi-hit loops *inside the move pipeline* (not via the queue), matching
pokered's per-call counter (§5). For Gen-1 the queue holds at most the two chosen actions plus
forced/switch insertions; the full priority table is generality scaffolding wired minimally.

### 1.5 The `Effect` concept

An effect = id/type + a sparse table of `(Event → HandlerFn, order/priority/sub_order)`. Moves,
statuses, abilities, items all share this shape (Showdown's `BasicEffect`). All Pokémon specifics
live in **pokered**, registered via an `EffectProvider` (analogous to `BattleAiProvider:
BattleProvider`). The engine ships the machinery with **zero Pokémon types**.

```rust
pub struct EventHook<P> {
    pub event: Event, pub call: HandlerFn<P>,
    pub order: u32, pub priority: i32, pub sub_order: Option<u8>,
}
pub struct Effect<P> { pub id: EffectId, pub kind: EffectType, pub hooks: &'static [EventHook<P>] }

pub trait EffectProvider: BattleProvider {
    fn effect_for_move(&self, m: &Self::Move) -> &'static Effect<Self>;
    fn effect_for_status(&self, s: &Self::Status) -> &'static Effect<Self>;
    fn effect_for_volatile(&self, v: VolatileId) -> &'static Effect<Self>;
}
```

---

## 2. The StackDriver — fixed firing sequence

`StackDriver::execute_turn(provider, &mut state, [BattleAction; 2], &mut rng)` replaces
`BattleDriver::execute_turn`. Per turn:

```
1. resolve order  → speed_sort + speed-tie draw                       (Event::BeforeTurn)
2. for actor in [first, second]:
     a. run BeforeMove  (confusion, para, sleep gate …)  — may abort   (status draws here)
     b. if move acts: ModifyMove/Type → ModifyCritRatio(+crit draw)
                      → Accuracy(+acc draw) → ModifyDamage(+dmg roll)
                      → Damage/DamagingHit → Hit/secondary(+effect draws)
                      → AfterMove
     c. *** fire Residual + faint-check FOR THIS ACTOR ***   ← per-mover, interleaved (§6 gap #1)
     d. if this actor's residual KO'd it, OR the move KO'd the defender → STOP (cancel 2nd move)
3. (no end-of-turn residual pass — Gen-1 does it per-mover, step 2c)
```

This per-mover interleave is a **Gen-1-driven engine structural choice**, not a handler and not a
gen-1 special-case branch — exactly the way Showdown's own driver encodes turn structure. The
current `BattleDriver` fires `Residual` once at end-of-turn (`driver.rs:274`); pokered interleaves
per-mover with first-mover-faint short-circuit (`turn.rs:48-60`). The `StackDriver` adopts the
pokered shape. Be honest in the code comments: this is structure the gen-1 effects *rely on*.

---

## 3. Borrow-checker strategy (the Rust crux)

**Never hand a handler `&mut BattleState` plus borrowed battler refs** — handlers mutate `target`
while reading `source` and the effect registry, which would alias. Instead: store everything in
**arena `Vec`s keyed by index/id**, pass handlers a `BattleCtx` of *split* accessors, and resolve
via the **relay fold** where the dispatch loop owns iteration and re-borrows per step.

### 3.1 Effect state — typed, not a positional slot bag

The critique correctly rejected `SmallVec<[i32; 4]>` indexed positionally (magic indices, no type
safety; Bide/Wrap/Disable strain four slots). Use a **typed per-effect-kind enum** so the compiler
checks every counter:

```rust
pub struct EffectState {
    pub id: EffectId, pub host: BattlerRef, pub effect_order: u64,
    pub kind: EffectStateKind,
}
pub enum EffectStateKind {
    None,
    Toxic   { counter: u8 },                                // bug #6 (uncapped multiplier)
    MultiHit{ hits_left: u8, total: u8 },                   // bug #24/#25
    LockedMove { move_: MoveSlot, turns_left: u8 },         // Thrash/Petal Dance #17
    Trapping{ turns_left: u8 },                             // Wrap/Bind/… #16
    TwoTurn { charging: bool },                             // Fly/Dig/SolarBeam #15
    Bide    { accumulated: u16, turns_left: u8 },           // bug #18
    Disable { move_: MoveSlot, turns_left: u8 },
    Substitute { hp: u8 },                                  // #28
    // … one variant per stateful gen-1 volatile; new games add variants
}
```

This stays game-agnostic at the *engine* level by making `EffectStateKind` a **generic associated
type or a game-supplied enum** (`type EffectStateKind` on `EffectProvider`); the engine treats it
opaquely (it only stamps `effect_order` and routes it to the host). pokered supplies the gen-1 enum
above. (Simplest first cut for the POC: a concrete enum behind the provider; promote to an associated
type when a second game lands.)

### 3.2 The context and split-borrow accessors

```rust
pub struct BattleCtx<'a, P: EffectProvider + ?Sized> {
    pub state:   &'a mut BattleState<P>,    // existing: player_battlers / opponent_battlers Vecs
    pub effects: &'a mut Vec<EffectState>,  // arena keyed by id (binary search)
    pub mv:      &'a mut MoveContext<P>,    // per-move scratch: damage, crit, move_missed, last_damage
    pub rng:     &'a mut dyn BattleRng,     // the ONLY randomness source (§4)
    pub log:     &'a mut Vec<TurnEvent<P>>, // engine→UI projection (existing enum, reused)
}

impl<'a, P: EffectProvider + ?Sized> BattleCtx<'a, P> {
    pub fn battler_mut(&mut self, r: BattlerRef) -> &mut BattlerState<P> {
        match r.side { 0 => &mut self.state.player_battlers[r.slot as usize],
                       _ => &mut self.state.opponent_battlers[r.slot as usize] }
    }

    /// Two disjoint battler refs as two `&mut`. Cross-side is trivial (two different Vecs).
    /// SAME-side (doubles, and any handler reading its own host while writing a teammate)
    /// needs a real disjoint split — shown here, not left as a comment (critique fix).
    pub fn pair_mut(&mut self, a: BattlerRef, b: BattlerRef)
        -> (&mut BattlerState<P>, &mut BattlerState<P>)
    {
        debug_assert!(a != b);
        if a.side != b.side {
            // disjoint Vecs → two independent &mut, no split needed
            let pa: *mut _ = self.battler_mut(a);
            let pb: *mut _ = self.battler_mut(b);
            // safe: a.side != b.side ⇒ different Vecs ⇒ provably disjoint
            unsafe { (&mut *pa, &mut *pb) }
        } else {
            let v = if a.side == 0 { &mut self.state.player_battlers }
                    else { &mut self.state.opponent_battlers };
            // disjoint slots in ONE slice → split_at_mut (stable, safe; no raw ptr).
            // (Once MSRV permits, replace with the safe `<[T]>::get_disjoint_mut`.)
            let (lo, hi) = (a.slot.min(b.slot) as usize, a.slot.max(b.slot) as usize);
            let (left, right) = v.split_at_mut(hi);
            let (first, second) = (&mut left[lo], &mut right[0]);
            if a.slot < b.slot { (first, second) } else { (second, first) }
        }
    }
    pub fn effect_mut(&mut self, id: EffectId) -> &mut EffectState { /* binary search by id */ }
}
```

The cross-side raw-pointer pair is the **one** localized `unsafe` and it is provably sound (the two
sides are separate `Vec`s, so `a.side != b.side` guarantees non-aliasing). The same-side path is
**fully safe** via `split_at_mut`. Gen-1 single-battle uses only the cross-side path; the same-side
path exists for Counter-shaped self+foe reads and future doubles, and it compiles today. If we want
zero `unsafe`, the cross-side branch can instead `mem::take` one battler, mutate, and put it back —
but the raw-pointer form is cleaner and the safety argument is airtight.

### 3.3 Representative handler (Toxic residual, bug #6)

```rust
fn toxic_on_residual<P: EffectProvider + ?Sized>(
    ctx: &mut BattleCtx<P>, _relay: RelayVar, target: BattlerRef, _src: BattlerRef, eff: EffectId,
) -> HandlerResult {
    let n = match &mut ctx.effect_mut(eff).kind {        // typed: compiler checks the variant
        EffectStateKind::Toxic { counter } => { *counter = counter.saturating_add(1); *counter as u16 }
        _ => return HandlerResult::Unchanged,
    };
    let max = ctx.battler_mut(target).max_hp;
    let dmg = (max / 16).max(1) * n;                     // bug #6: uncapped multiply, min 1
    ctx.battler_mut(target).take_damage(dmg);
    ctx.log.push(TurnEvent::Residual { /* …amount: dmg */ });
    HandlerResult::Unchanged                              // residual is side-effecting; relay untouched
}
```

### 3.4 Dispatch loop (`run_event`, the workhorse)

```rust
pub fn run_event<P: EffectProvider + ?Sized>(
    ctx: &mut BattleCtx<P>, ev: Event, target: BattlerRef, source: BattlerRef,
    mut relay: RelayVar, fast_exit: bool,
) -> RelayVar {
    let mut hs = find_event_handlers(ctx, ev, target, source);  // Vec<CollectedHandler<P>>
    hs.sort_by(compare);                                        // §1.3 comparator (stable)
    speed_sort_tiebreak(&mut hs, ctx.rng);                      // RNG only on exact ties
    for h in hs {
        if !is_alive(ctx, h.target) { continue; }              // dynamic re-check (faint mid-fold)
        match (h.call)(ctx, relay, h.target, h.source, h.source_effect) {
            HandlerResult::Unchanged  => {}
            HandlerResult::Set(v)     => { relay = v; if fast_exit { return relay; } }
            HandlerResult::Fail       => return RelayVar::Bool(false),  // with message
            HandlerResult::FailSilent => return RelayVar::Unit,         // silent
        }
    }
    relay
}
// single_event(effect, ev, …) — fire ONE known effect's hook (recursion-guarded, depth ≤ 8).
// priority_event(…) = run_event with fast_exit=true — return on first Set (redirection/first-blood).
```

**Why this compiles:** handlers take `&mut BattleCtx`, never borrowed battler refs. The loop owns
`hs` (collected *before* the fold, so no handler can be invalidated by another adding/removing an
effect mid-fold — adds queue into `ctx.effects` and take effect next event). The `&mut` borrow of
`ctx` lives only inside each call; between calls the loop holds the sole `&mut`. No `RefCell`, no
`unsafe` in the hot path (the only `unsafe` is the provably-disjoint cross-side `pair_mut`).

---

## 4. Determinism & parity

Randomness flows **only** through the existing `BattleRng` trait (`rng.rs`); `jrpg-engine` never
links `rand` (transitively either). Draws happen at **fixed points in a fixed order**, so a battle
is reproducible from `(seed, teams, ordered choices)`. The canonical draw order **equals pokered's
`MoveRandoms` field order** (`move_execution.rs:29`), per mover:

```
order_random → speed-tie shuffle (only on exact tie)            turn_order.rs:41
per mover (MoveRandoms): confusion_roll → paralysis_roll        status_checks.rs:97,111  (BeforeMove)
                       → crit_roll      → accuracy_roll          move_execution.rs:168 / accuracy.rs:67
                       → damage_roll                             damage.rs:157
                       → effect_randoms{side_effect,duration,multi_hit}  effects/mod.rs:15
```

Crit is drawn **before** accuracy (bug-critical). In the stack this is guaranteed by **the sequence
the `StackDriver` fires events in** (§2 step 2b), *not* by handler priority — `ModifyCritRatio`+crit
draw runs before the `Accuracy` draw.

### 4.1 The RNG-shape mismatch — the deepest risk, named honestly

The critique is right and the earlier draft underweighted this: **the oracle does not stream an
RNG.** `pokered::battle::turn::execute_turn` takes a **pre-rolled `TurnRandoms` struct**
(`turn.rs:8-11`) — all bytes decided up front as named fields per mover (`first_mover.crit_roll`,
…); tests literally construct them (`always_hit_randoms()`, `move_execution.rs:364`). The
`StackDriver` instead **streams `rng.next_u8()` lazily as events fire** (mirroring
`driver.rs:362`). These are two different RNG *shapes* — a flat struct vs an ordered stream — so
`rng.consumed()` parity is **not automatic** and is **not even meaningful against the struct
oracle** as-is.

**The honest parity oracle is: "same `BattleState` after the turn, given the same bytes."**
Byte-stream draw-order parity is an **engineering obligation the POC must establish**, not a free
property.

**The shim that makes them comparable** (build this in the POC, slice 1):

```
                 ┌──────────────────────────────────────────────┐
   seed bytes ──►│  byte vector  b0 b1 b2 …                      │
                 └───────┬───────────────────────┬──────────────┘
                         │                        │
            lay into TurnRandoms fields     feed ScriptedRng in
            in pokered's struct order       stack FIRE order
                         │                        │
                  legacy execute_turn       StackDriver::execute_turn
                         │                        │
                   BattleState_A   ===diff===  BattleState_B   (must be identical)
                                  AND consumed() == byte count
```

The shim proves the stack's fire-order equals the struct field order by construction *for the slice
under test*. The discipline (`assert rng.consumed() == N` + diff `BattleState` after each handler,
not just end-of-turn) catches mid-event order drift that would otherwise cancel out by turn-end.
Add a **seeded full-turn differential fuzz** (random byte vectors → both paths → diff) before any
slice swap. Replay = snapshot/restore RNG state (`ScriptedRng` is already `Clone`).

---

## 5. Reused vs retired from the current engine battle module

| Item (engine `crates/jrpg-engine/src/battle/`) | Verdict | Why |
|---|---|---|
| `BattleRng` + `ScriptedRng` (`rng.rs`) | **REUSE verbatim** | the determinism contract; the stack routes every draw through it. `consumed()`/`Clone` are the parity + replay primitives. |
| `BattlerState<P>`, `BattleState<P>` (two party Vecs) | **REUSE** (extend) | pure state shape, no control-flow opinion; the stack mutates these same structs. Add an `EffectState` arena alongside (volatile counters not currently modeled). |
| `EnumMap`, `BattlerRef`, `OrderKey`, `Weather`/`Terrain`, `DamageResult` | **REUSE** | small value types; `BattlerRef` is the handler addressing key; `OrderKey` seeds the queue compare. |
| `BattleAction<P>`, `MoveGate<P>` | **REUSE** | the input/decision vocabulary; `MoveGate::ForcedAction` is exactly how multi-turn lock-in (Thrash/Wrap/Dig/Hyper-Beam-recharge/Bide) overrides the chosen action. |
| `TurnEvent<P>`, `TurnOutcome`, `BattleEnd` | **REUSE as the UI projection** | keep as the engine→UI observable stream; internal dispatch uses the richer `Event` kinds. Closed 8-variant `TurnEvent` stays the *output*; `Event` is the *internal* bus. |
| `ai::{BattleAiProvider, BattleAi}` | **REUSE** | orthogonal to turn execution. |
| `BattleProvider` assoc types + `calculate_damage`/`create_monster`/`check_faint`/`TypeChart` | **REUSE** | the game's data/formula injection point; `EffectProvider: BattleProvider` extends it. |
| `BattleDriver::execute_turn` template method (`driver.rs:226`) | **RETIRE → demote to a "simple turn-based" tier** | the fixed phase order (order → before_move → accuracy → crit → damage → end_of_turn) is precisely what the stack replaces with event broadcast + subscriber priority. **Recommendation: keep it, renamed, as a documented "no-effects, fixed-pipeline" battle tier** for trivial JRPGs that don't want the stack — it already works and costs nothing to keep. pokered moves off it onto `StackDriver`. Do **not** delete (the strangler keeps both alive). |
| Provider hooks `before_move`/`accuracy_check`/`end_of_turn`/`roll_critical`/`turn_order_key` (`mod.rs:468-554`) | **RETIRE as hard call-sites; keep during strangler** | under the stack these become event subscriptions (`OnBeforeMove`/`OnAccuracy`/`OnResidual`/`OnModifyCrit`/`OnModifySpe`). They stay defaulted so the old `BattleDriver` keeps compiling; deprecate after the swap. (Note: pokered's real provider overrides only `turn_order_key`.) |
| `MoveEffect` (closed 13-variant taxonomy) + `EffectHandler`/`apply_move_effect` | **RETIRE** | this is the thing pattern C dissolves: a move is no longer classified into one enum tag — it *is* an `Effect` subscribing to events. `EffectResult` survives only as a `TurnEvent` payload. |
| legacy `BattleAI<P>` (`mod.rs:753`) | **RETIRE** | superseded by `ai::BattleAiProvider`; only `hello_jrpg` references it. |

**On the pokered side:** `BattlerState`/`BattleState`/the `status1/2/3` volatile bitflags, the
`MoveRandoms`/`EffectRandoms` structs, and the ~410 `#[cfg(test)]` blocks are **the oracle** — they
do not change; they validate each migrated slice. The ~13k LOC of native handlers in
`pokered-core::battle::{damage,accuracy,status_checks,residual,effects/*}` are **re-homed** into
`Effect`/`HandlerFn` instances (logic preserved, call shape changed), not rewritten.

---

## 6. Gen-1 deliberate-bug catalog → effects/handlers

S = **structural** (constrains engine: control flow / event order / RNG draw order — the stack must
be *designed around* it). L = **local** (formula/threshold tweak inside one handler — low risk).

| # | Quirk | Maps to | Code (pokered) | S/L |
|---|---|---|---|---|
| 1 | Focus Energy *divides* crit by 4 | `ModifyCritRatio` handler on FocusEnergy volatile | `damage.rs:32-50` | **L** |
| 2 | 1/256 miss (acc as `acc*255/100` int, `byte<acc`) | `Accuracy` returns 0..=255 INT; never float % | `accuracy.rs:50,67` | **S** (draw+compare order) |
| 3 | Crit uses *base* Speed, ignores stage; high-crit ×8 | `ModifyCritRatio` reads species base speed via provider | `damage.rs:34-50` | L |
| 4 | Type-immunity → "miss" (not just 0 dmg) | `Effectiveness`/`ModifyDamage` handler sets miss flag → short-circuits Hit chain | `types.rs:92,112` | **S** (must abort downstream) |
| 5 | Stat overflow `>>2` (min 1) when >255 | stat-fetch handler before formula | `damage.rs:77-86` | L |
| 6 | Toxic counter persists & multiplies (uncapped) | `Residual` handler holding `EffectStateKind::Toxic{counter}` | `residual.rs:34-38` | L (state) |
| 7 | Burn/Psn/Leech each min-1, can KO; fixed order | ordered `Residual` handlers (`order:10` status, later leech) | `residual.rs:29-44,82` | **S** (handler order load-bearing) |
| 8 | Sleep loses turn even on wake tick | `BeforeMove` sleep handler returns "can't move" on wake | `status_checks.rs:36-51` | **S** |
| 9 | Sleep duration `(roll&7).max(1)` | duration roll handler | `effects/status_effects.rs:14` | L |
| 10 | Freeze permanent (only Fire/Haze thaws) | freeze handler has NO thaw RNG | `status_checks.rs:54-58` | L |
| 11 | Para 25% full + speed ÷4 | `BeforeMove` para + `ModifySpe` ÷4 | `status_checks.rs:109`, `turn_order.rs:61` | L (S for ÷4 in order calc) |
| 12 | Status-check FIXED order (sleep→…→para) | `BeforeMove` subscriber priority reproduces exact order | `status_checks.rs:22-117` | **S** (the whole ballgame) |
| 13 | Confusion 50% self-hit, typeless 40-pow | confusion `BeforeMove` injects a special damage calc | `status_checks.rs:96`, `move_execution.rs:62` | **S** |
| 14 | Hyper Beam: no recharge if target faints/whiffs | `AfterMove` handler conditioned on target alive | `effects/multi_turn_effects.rs:101` | L |
| 15 | Fly/Dig invuln (CHARGING_UP+INVULNERABLE) | `TwoTurn` volatile; `Invulnerability` gate | `effects/multi_turn_effects.rs:7` | **S** (multi-turn state + fast_exit gate) |
| 16 | Partial-trap locks the *opponent* out | trap volatile on attacker + cross-mon `BeforeMove` check on defender | `multi_turn_effects.rs:31`, `status_checks.rs:60` | **S** (cross-battler) |
| 17 | Thrash/Petal Dance 3–4 turns → self-confuse | `LockedMove` volatile; on expiry add Confusion via `End` | `multi_turn_effects.rs:73` | **S** (forces action) |
| 18 | Bide doubles (not triples) accumulated dmg | `Bide` volatile accumulates via `Damage`, releases ×2 | `multi_turn_effects.rs:52` | **S** (reads last_damage) |
| 19 | OHKO level gate; sets sentinel | OHKO `Hit` handler short-circuits damage + sets flag | `effects/damage_effects.rs:121` | L |
| 20 | Counter priority −1 (always last), reads dmg taken | queue `priority:-1`; handler reads a PER-BATTLER `EffectState::DamageTaken` (NOT `MoveContext` — reset per mover; see §9) and reflects ×2 via `pair_mut`. **Done in slice 6** (no legacy oracle: `MoveEffect` has no `CounterEffect`, dmg direct-pinned). | `turn_order.rs:15,52` (legacy has NO Counter dmg) | **S** (reactive) |
| 21 | Quick Attack +1 priority | queue `priority:+1` | `turn_order.rs:51` | L |
| 22 | Equal-speed coin flip `random<128` | speed-tie shuffle draws exactly one byte | `turn_order.rs:40` | **S** (RNG site) |
| 23 | Side-status blocked by own type & substitute | secondary handler checks target type vs *move* type + sub | `effects/status_effects.rs:85` | L |
| 24 | Twineedle poison only 2nd hit, 52/256 | multi-hit volatile + secondary on final hit | `effects/multi_hit_effects.rs:55` | L |
| 25 | 2–5 hit distribution 3/8,3/8,1/8,1/8 | `ModifyMove` sets hit count from one roll | `effects/multi_hit_effects.rs:11` | L |
| 26 | Metronome skips slot 0x76 | Metronome handler explicit exclusion | `effects/special_effects.rs:86` | L |
| 27 | Mimic overwrites slot, PP=5 | move-replace handler | `effects/special_effects.rs:72` | L |
| 28 | Substitute eats status/flinch/secondary, absorbs dmg | high-priority `Damage`/`TryHit`/`TrySetStatus` absorb+block | `effects/damage_effects.rs:61`, `special_effects.rs:226` | **S** (cross-effect interception) |
| 29 | Final dmg `×roll/255`, min 1 | damage-roll handler ÷255 (not 100), min 1 | `damage.rs:157`, `damage_effects.rs:94` | L |
| 30 | Stat stages clamp −6..+6, table denom 100 | stat-stage modifier (table, not float) | `stat_stages.rs:26-34` | L |

**Structural cluster (design the stack around these):** RNG draw order (#2/#3/#4/#22/#29 sites),
`BeforeMove` ordering + sleep-loses-turn (#8/#12/#13), immunity-as-miss short-circuit (#4), residual
ordering + per-mover interleave (#7 + §2 gap), cross-battler interception (#16/#28), multi-turn
volatiles that hijack action selection (#15/#17/#18/#14), and the reactive Counter/Bide read of
`last_damage` (#18/#20). Everything else is a local formula port, single-test-gated.

---

## 7. Strangler migration plan

**Invariant:** build `battle::stack` as an **additive sibling module**; the production oracle stays
`pokered_core::battle::turn::execute_turn` (~14k LOC, ~410 tests). The engine's `BattleDriver` is
*not* in pokered's prod path, so a new `StackDriver` is built and proven slice-by-slice with **zero
disturbance to the live game**. The old loop stays in production until every slice is green.

**Slice order (by parity risk, highest first):**

1. **RNG shim + turn-order** — build the byte-vector↔`TurnRandoms`↔`ScriptedRng` shim (§4.1);
   turn-order parity is *already proven* (`turn_order.rs` engine_parity_tests). Establishes the
   harness that every later slice depends on. **Retires risk #1 of §9.**
2. **`BeforeMove` status gate + sleep-loses-turn** (#8/#12/#13) — subscriber-priority ordering is
   the subtlest source of silent drift.
3. **crit → accuracy → damage pipeline** with per-draw `consumed()` assert (#2/#3/#4/#5/#29).
4. **Substitute / partial-trap cross-battler interception** (#16/#28) — exercises `pair_mut` +
   high-priority interceptors.
5. **residual / toxic stacking** with per-mover interleave + first-mover-faint short-circuit
   (#6/#7 + §2 gap #1).
6. **multi-turn volatiles + Counter/Bide** (`MoveGate::ForcedAction` → the generic+defaulted
   `EffectProvider::forced_action` seam; cross-action damage-taken as a per-battler `EffectState`,
   NOT `MoveContext`; #14/#15/#17/#18/#20). **DONE** — see §9 for the resolved open question.
7. **secondaries / special moves** (Metronome/Mimic/Twineedle …) last.
8. AI + menus are orthogonal; migrate last or never (they call into the stack, not vice-versa).

**Per-slice protocol:** register the gen-1 effects for the slice → run the relevant `#[cfg(test)]`
block (the oracle) → run a seeded full-turn differential fuzz against `execute_move` /
`apply_all_residual` → assert (a) `BattleState` identical after each handler and (b)
`rng.consumed()` matches the legacy byte count. **Swap criteria for a slice:** full `BattleState`
parity on the existing tests **and** the differential fuzz, **and** byte-stream draw-order match
(`consumed()` equal + per-step diff clean) across ≥N seeds. Only then route that slice's prod
call-site through the stack. **Global swap:** all slices green + a full-battle differential fuzz
(random teams, random choices, random seeds) clean before retiring `execute_turn`.

---

## 8. Vertical-slice POC spec (the smallest compiling slice that retires the top risks)

**Goal:** the smallest `battle::stack` that compiles, runs through the event chain, and *proves* the
three structural risks are solvable — before any production change.

**Scope (and exactly this):**
- **One damaging move end-to-end** through the event chain: `BeforeMove` →
  `ModifyCritRatio` (crit draw) → `Accuracy` (acc draw) → `ModifyDamage` (damage roll) →
  `Damage`/`DamagingHit`. Single battler per side.
- **One `BeforeMove` gate:** paralysis (25% full-para, draws one byte) — exercises the gate +
  abort path + a draw at the front of the pipeline.
- **One residual:** Poison (`order:10`, min-1) fired **per-mover** after the move, with the
  first-mover-faint short-circuit that cancels the second move (proves §2 gap #1 as engine
  structure).
- **One deliberate Gen-1 bug as a handler:** Focus Energy `/4` crit (#1) on `ModifyCritRatio` —
  proves bugs live entirely in pokered handlers, engine has no `if gen==1`.
- **A determinism / draw-order assertion:** the §4.1 shim — same byte vector → legacy
  `execute_turn` and `StackDriver` → assert identical `BattleState` **and** `rng.consumed()` equal,
  with crit-drawn-before-accuracy verified.
- **A same-side `pair_mut` compile-check:** one handler that mutates `target` while reading
  `source`'s host on the same side (Counter-shaped), proving no `RefCell` and the split-borrow body
  compiles.

**Go / No-Go criteria:**

| | GO | NO-GO (re-evaluate pattern C / borrow strategy) |
|---|---|---|
| Borrow | `run_event` fold + `pair_mut` (both branches) compile with no `RefCell`, only the one provably-disjoint cross-side `unsafe` | a handler needs `RefCell`/`Rc` to mutate target+source, or the fold can't re-borrow per step |
| Determinism | shim shows identical `BattleState` + equal `consumed()` for ≥1000 seeds; crit drawn before accuracy | byte-stream order cannot be made to match the struct field order without ad-hoc reordering |
| Fidelity | the para gate, poison residual, per-mover faint short-circuit, and Focus Energy `/4` all match the corresponding pokered tests | a structural quirk (#4 immunity-miss, #7 residual order, #12 status order) cannot be expressed in handler priority |
| Effort | the slice is < ~800 LOC of new engine code + pokered effect registrations | the machinery balloons (sign the comparator/queue/prefix synthesis is over-scoped for gen-1 — cut to §1.3 minimal wiring) |

A **No-Go on Borrow or Determinism** is the kill signal for pattern C as specified; everything else
is a tuning signal (scope down §1.3/§1.4 to the minimal gen-1 wiring).

---

## 9. Risks & open questions

**Top risks (ranked):**

1. **RNG-shape mismatch (§4.1).** Oracle is a pre-rolled struct; the stack streams. `consumed()`
   parity is *not* free; the shim must prove fire-order == struct field-order per slice. This is the
   deepest risk and the POC's first job. If the stack's natural fire order can't be made to equal
   pokered's struct order without contortion, parity is unfounded.
2. **`BeforeMove` status-order + immunity-as-miss as handler priority (#4/#8/#12/#13).** These
   require exact subscriber ordering and a downstream short-circuit; an effect-stack tends to get
   absorption/abort semantics *almost* right. Silent mid-event drift that cancels by turn-end is the
   nasty failure mode — hence per-handler diffing, not just end-of-turn.
3. **Cross-battler interception + same-side split-borrow (#16/#28, Counter).** Substitute/partial-
   trap read and write the *other* battler's eligibility/damage with correct priority; the same-side
   `pair_mut` path must compile cleanly (POC check). Risk that doubles-grade requirements leak into
   the gen-1 slice — mitigated by scoping §1.3 to minimal wiring.

**Open questions:**
- **`EffectStateKind`: associated type vs concrete enum?** Concrete (pokered-supplied) is simplest
  for the POC; promote to `type EffectStateKind` on `EffectProvider` when a second game needs
  different volatiles. Decide at slice 6. **RESOLVED (slice 6):** kept as the provider associated
  type `type EffectStateKind` (already on `EffectProvider` since slice 5). Slice 6 added five
  variants to the pokered enum (`LockedMove`/`TwoTurn`/`Recharge`/`Bide`/`DamageTaken`) with **zero
  engine change** — the engine still treats the kind opaquely. No second game has landed, so the
  associated-type-not-trait-bound shape stays; promote to richer generics only when one does.

- **Where does `MoveContext.last_damage` live** — per-turn scratch on the driver, or an
  `EffectState` on a synthetic volatile? Counter (#20) and Bide (#18) both need it; this is the
  canonical proof a per-turn `[Action; 2]` input is insufficient.
  **RESOLVED (slice 6) — the answer is SPLIT by read shape:**
  - **Same-action reads → `MoveContext.last_damage` (per-mover driver scratch).** Recoil/drain
    read the damage the *current* move just dealt; the driver already sets `mv.last_damage` after
    applying damage (driver.rs:167) and threads `mv` through the move's event chain. For these the
    recommended "per-turn scratch on the driver" answer holds verbatim.
  - **Cross-ACTION reactive reads (Counter, Bide) → a PER-BATTLER `EffectState` arena scratch,
    NOT `MoveContext`.** This is the load-bearing finding. `MoveContext` is reset **per mover**
    (the driver makes a fresh `mv`/`mv2` for each actor). Counter is −1 priority, so it reads the
    damage it took when the **opponent** moved — recorded under a *different* `MoveContext`, already
    discarded by the time Counter fires. Therefore the damage-taken-this-turn must live
    **per-battler in the arena** (pokered's `PocKind::DamageTaken { amount, physical }`), stamped by
    a `DamagingHit` handler on the defender and **reset at the start of every turn**. Counter reads
    its host's entry and reflects `amount*2` (physical only, bug #20); Bide's per-turn `Residual`
    tick folds the same scratch into its `Bide{accumulated}` and releases `accumulated*2` (bug #18).
    This is the concrete proof a per-turn `[Action; 2]` input is insufficient: the reactive read
    needs state recorded by the *other* action.

- **Cross-turn LOCKED-MOVE / Bide / two-turn / recharge state → the `EffectState` arena, hijacking
  the action via a NEW generic+defaulted engine seam.** Thrash's lock counter, Fly/Solar Beam's
  charge flag, Hyper Beam's recharge flag, and Bide's accumulator all persist across turns in the
  same arena slice 5 introduced. To let a volatile recorded on a *prior* turn override *this* turn's
  chosen action, slice 6 added **`EffectProvider::forced_action(&effects, actor, chosen) ->
  Option<BattleAction>`** (ctx.rs) — consulted by the `StackDriver` before each `resolve_action`
  (driver.rs). It is **generic** (the engine names no Pokémon volatile; it only swaps one
  `BattleAction` for another — the `MoveGate::ForcedAction` shape reused at the stack layer),
  **defaulted to `None`**, and therefore **completely inert** for every other game and for slices
  1–5. All Gen-1 lock-in semantics (which volatile forces which move, the lock counter decrement,
  the charge→strike flip, the recharge skip = `BattleAction::Nothing`, the self-confuse on fatigue)
  live in pokered's `forced_action` + the volatiles' `Residual` lifecycle handlers — never in the
  engine. **This `forced_action` seam is the only engine change slice 6 required.**

- **How far to wire the queue (§1.4) for gen-1?** Gen-1 needs only two actions + forced/switch
  inserts; full `resolve_action`/priority-table is generality scaffolding. Recommend: minimal now,
  seams kept. **RESOLVED (slice 6):** still minimal — lock-in does NOT push queue actions; it
  overrides the existing `[Action; 2]` slot via `forced_action`, so the queue stays the two chosen
  actions. The priority table (`Counter -1`/`Quick Attack +1`) rides on `turn_order_rank` as before.

- **Cross-side `pair_mut`: keep the localized `unsafe`, or `mem::take`-and-restore for zero unsafe?**
  Both are sound; pick during POC based on reviewer taste. **RESOLVED:** kept the localized
  cross-side `unsafe` (ctx.rs) — slice 6's Counter is the handler that finally makes it
  **genuinely load-bearing** (read the Counter user / source while writing the opponent / target
  through the SAME paired `&mut`), and it compiles with no `RefCell`/`Rc`, vindicating the choice.

- **`single_event` recursion guard depth** (Showdown caps at 8) — confirm gen-1 never legitimately
  nests deeper (Bide-unleash → damage → Substitute absorb is depth 2-3); set the cap, assert in
  tests. **Deferred:** the POC driver fires events iteratively, not recursively (Bide unleash and
  Counter reflect apply damage directly via `pair_mut`, no re-entrant `single_event`), so no guard
  is needed yet; revisit when a handler re-fires an event.
