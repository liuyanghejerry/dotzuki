# No-code authoring for the battle effect-stack — design

> **STATUS (point-in-time design).** This records the *original* no-code design and
> its first op vocabulary (12 ops / 3 predicates). The vocabulary has since grown
> with the pokered Gen-1 migration to **16 ops** (`+ SetHp, SetDamage,
> DamageCurrentHpFraction, RepeatHits`) and **7 predicates** (`+ HasVolatile,
> MoveTypeIsDefenderType, TargetHasStatus, LevelGE`), plus `FractionOf::LastDamage`
> and the `DamageValue` / `HitCount` / `FinalHitRider` support enums. **For the
> current, authoritative vocabulary see [`../BATTLE_ENGINE_GUIDE.md`](../BATTLE_ENGINE_GUIDE.md)
> §5.1** (kept in sync with `crates/jrpg-rules/src/model.rs`); this doc is the
> design rationale, not the live reference.

> **Scope.** How a developer defines **moves / abilities / items / weather +
> a battle ruleset** for `jrpg_engine::battle::stack` **without writing Rust** —
> as declarative *data* bound to a closed vocabulary of engine-shipped effect
> primitives. This is the lead-architect synthesis of three competing designs
> (declarative-data, embedded-script, hybrid) plus the adversarial critique; it
> picks the critique's recommendation and grounds it in the real engine types.
>
> **Companion docs.** This pairs with the native-`fn`-pointer authoring path in
> [`../BATTLE_ENGINE_GUIDE.md`](../BATTLE_ENGINE_GUIDE.md) (concepts: `Effect`,
> `Event`, `RelayVar`, `HandlerResult`, the `comparePriority` comparator, the
> `effect!` macro) and assumes it. It is a **separate** document from the broader
> [`../DEVELOPER_GUIDE.md`](../DEVELOPER_GUIDE.md) (maps/NPCs/scripting/rendering,
> from PR #50), which predates the battle stack and does **not** cover it; the
> only cross-link to that guide is for the existing **overworld** Boa scripting,
> discussed in §4.3 as a deliberate non-reuse.
>
> **Constraint.** Docs/design only. No engine or example edits are made in this
> workflow; the one *additive* engine seam this design would eventually need is
> called out and marked **ENGINE-WORK** in §2.2, and the recommended first
> deliverable needs **none** of it.

Legend: **[ENGINE-WORK]** = a change inside `crates/jrpg-engine`. **[AUTHORING-WORK]**
= game-side / data-side only, no engine edit. The recommended POC (§6) is
**100% [AUTHORING-WORK]**.

---

## 0. The recommendation, in one paragraph

**Author content as declarative data bound to a closed primitive vocabulary, not
as a scripting VM.** A ruleset is one (de)serializable table of *effect records*;
each record's hooks are lists of **primitive ops** drawn from a closed,
engine-shipped enum, each op mapping 1:1 to an existing `BattleCtx`/`RelayVar`
operation. A single generic interpreter `fn`-pointer makes the data **foldable by
the existing `run_event`**. This is recommended over embedding JS handlers because
it is **the only one of the three designs that ships with no engine edit at all**
(via "Option A" below), it is **determinism-safe by construction** (the parity
core's non-negotiable), it has the **smallest attack surface** (a closed enum, no
`eval`, no codegen), and it is serializable + hot-reloadable. The embedded-JS path
is retained, fully designed, as the **documented escape hatch** for genuinely novel
mechanics the vocabulary can't express (§5, §7) — *not* as the default.

Why not embedded JS as the default: it costs the most invasive engine seam, trades
away the closed-`Event`-set audit guarantee, makes determinism a *review* burden
rather than a structural property, and its "we already have Boa in-repo" advantage
is largely illusory — the in-repo Boa integration is **async** (see §4.3) and
cannot be reused inside the synchronous `run_event` fold.

---

## 1. The authoring format

A ruleset is a flat table of **effect records**. Each record =
`{ id, kind, category?/power?/type?/accuracy?…, hooks: [...] }`. A hook is
`{ on: <Event>, order?, priority?, chance?, do: [<op>…] }`. `do` is a list of
**primitive ops** from a closed vocabulary; each op is parameterized by *data
only*. The only control flow is `chance` (an RNG gate) and the engine's existing
`Fail`/`FailSilent`/`Set(fast_exit)` short-circuit — no loops, no branches beyond
predicate guards. The five canonical minimon systems (the
[`examples/minimon`](../../examples/minimon/src/lib.rs) reference: phys/special
split + Intimidate + Clear Body veto + Leftovers + Sandstorm) re-expressed as
data:

```ron
// rules.ron — the whole no-code ruleset, hot-reloadable, serializable.
Ruleset(
  // Opaque to the engine; the provider maps these names ↔ P::Stat / P::Type keys.
  stats: ["Hp","Atk","Def","SpA","SpD","Spe"],
  types: ["Normal","Rock","Fire"],
  effects: [
    // (split) A DAMAGING MOVE. Physical/special split needs NO engine change:
    // the provider's calculate_damage reads Atk/Def vs SpA/SpD by `category`,
    // exactly as minimon's MinimonProvider::calculate_damage does (lib.rs:232).
    Effect(id:"move.tackle", kind:Move, category:Physical, power:40, type:"Normal", accuracy:100,
      hooks:[ Hook(on:"ModifyDamage", do:[ DealMoveDamage ]) ]),         // provider-computed
    Effect(id:"move.ember",  kind:Move, category:Special,  power:40, type:"Fire",   accuracy:100,
      hooks:[
        Hook(on:"ModifyDamage", do:[ DealMoveDamage ]),
        Hook(on:"DamagingHit", order:10, chance:30, do:[                 // 30% secondary burn
          InflictStatus(status:"burn", target:Target) ]),
      ]),

    // (a status the on-hit effect installs) — residual chip.
    Effect(id:"status.poison", kind:Status,
      hooks:[ Hook(on:"Residual", order:10, do:[                          // order 10 = BEFORE Leftovers
        DamageFraction(num:1, den:8, of:MaxHp, target:Host) ]) ]),

    // (b) Intimidate — on switch-in, request -1 foe Atk (vetoable; see §3).
    Effect(id:"ability.intimidate", kind:Ability,
      hooks:[ Hook(on:"SwitchIn", order:10, do:[ Boost(stat:"Atk", stages:-1, target:Foe) ]) ]),
    // (c) Clear Body — veto any negative boost on the holder. Fires on the SAME
    //     TryBoost dispatch as Intimidate's request; order 5 (before later folds).
    Effect(id:"ability.clearbody", kind:Ability,
      hooks:[ Hook(on:"TryBoost", order:5, do:[ VetoIf(cond:RelayIntLt(0)) ]) ]),

    // (d) Leftovers — heal 1/16 each end-of-turn, AFTER the status chip.
    Effect(id:"item.leftovers", kind:Item,
      hooks:[ Hook(on:"Residual", order:20, do:[                          // order 20 = AFTER poison
        HealFraction(num:1, den:16, of:MaxHp, target:Host) ]) ]),

    // (e) Sandstorm — chip non-Rock 1/16; ×1.5 SpD for Rock. Field-hosted.
    Effect(id:"weather.sandstorm", kind:Weather,
      hooks:[
        Hook(on:"FieldResidual",     order:50, do:[
          DamageFraction(num:1, den:16, of:MaxHp, target:Target, unless:HasType("Rock")) ]),
        Hook(on:"WeatherModifyStat", order:50, do:[
          ScaleRelay(num:3, den:2, when:[ HasType("Rock"), StatIs("SpD") ]) ]),
      ]),
  ],
)
```

`kind` (`Move`/`Status`/`Ability`/`Item`/`Weather`) maps to `EffectType`
(`event.rs:250`) **and** decides which provider resolver hosts the effect
(`effect_for_move`/`_status`/`_ability`/`_item`/`field_effects`/`side_effects`,
`ctx.rs:30-177`). `category` is a per-move flag the provider's damage formula
reads — the engine already indexes an opaque `EnumMap<P::Stat>`, so the
physical/special split is **pure provider + data**, zero engine change.

### 1.1 The primitive vocabulary (the entire expressiveness budget)

A closed enum the engine (or, in Option A, the game) ships. A representative set,
each mapping 1:1 to an op already present on `BattleCtx`/`RelayVar`:

| Primitive | Params | Maps to (grounded) |
|---|---|---|
| `DealMoveDamage` | — | writes `ctx.mv.damage` from the provider formula (`mv` is `MoveContext`, `ctx.rs:278`) |
| `DamageFraction` / `HealFraction` | `num,den,of,target,unless?` | `battler_mut(t).take_damage / heal` (minimon `lib.rs:488,511`) |
| `InflictStatus` | `status,target` | fires nested `TrySetStatus`, then sets status |
| `Boost` | `stat,stages,target` | fires nested `TryBoost`, applies if not vetoed (the minimon Intimidate→TryBoost→Clear-Body pattern) |
| `ScaleRelay` | `num,den,when?` | `RelayVar::scale(num,den)` → `HandlerResult::Set` (`event.rs:207`; minimon Sandstorm `lib.rs:556`) |
| `SetRelay` / `AddRelay` / `ClampRelay` | ints | numeric folds via `RelayVar::as_int()` etc. (`event.rs:170-200`) |
| `VetoIf` | `cond` | `HandlerResult::Fail` / `FailSilent` (minimon Clear Body `lib.rs:446`) |

`Target`/`Foe`/`Host`/`Source` are a small **selector enum** resolved against the
hook's `target`/`source` `BattlerRef`s. Conditions (`HasType`, `StatIs`,
`RelayIntLt`) are a closed predicate enum. **That closed set is the limit** (§5).

---

## 2. The runtime-effect bridge — making data foldable by `run_event`

### 2.1 The exact gap

The fold's only handler call site is a **zero-capture `fn` pointer** copied by
value: `CollectedHandler.call: HandlerFn<P>` (`dispatch.rs:32`), invoked as
`(h.call)(ctx, relay, h.target, h.source, h.source_effect)` (`dispatch.rs:286,
334`), and `EventHook`/`CollectedHandler` are `Copy` with `'static` zero-alloc
hook tables (`event.rs:300-323`, `authoring.rs`). **Data cannot *be* a `fn`
pointer.** The bridge is: one generic interpreter `fn` that all data hooks point
at, which on each call looks its op-list up by the `EffectId` the engine **already
threads** to every handler as `source_effect` (`dispatch.rs:128`).

```rust
// GAME-SIDE registry (NOT engine), keyed by EffectId, parsed from rules.ron:
struct DataHook { event: Event, order: u32, priority: i32, chance: Option<(u32,u32)>, ops: Vec<Op> }

// THE bridge: a single zero-capture fn every data hook's `call` field points at.
fn interpret<P: EffectProvider + ?Sized>(
    ctx: &mut BattleCtx<'_, P>, relay: RelayVar,
    target: BattlerRef, source: BattlerRef, source_effect: EffectId,
) -> HandlerResult {
    let ops = P::ops_for(source_effect);      // &[Op] for the firing hook (Option A: keyed directly)
    run_ops(ctx, relay, target, source, ops)  // a pure interpreter over ctx + the closed op enum
}
```

`run_ops` mutates **only through `ctx`** (`battler_mut`, `pair_mut`, `effect_mut`,
`ctx.rs:304-371`) and captures nothing, so the collect→owned-snapshot→fold borrow
discipline (`dispatch.rs:160-164`) is **untouched**: no `RefCell`, no `Rc`, no new
`unsafe`. The catch: `interpret` only gets `EffectId`, not *which* `EventHook`
fired. Two resolutions:

### 2.2 Two ways to resolve "which op-list"

- **Option A — one synthesized `EffectId` per `(effect, event)` hook. [AUTHORING-WORK,
  zero engine change — RECOMMENDED FIRST].** The loader mints a distinct `EffectId`
  per hook program and registers each as its own tiny runtime `Effect` *through the
  existing resolvers* (the multi-source collector already gathers many effects per
  source, `dispatch.rs:165-227`). Each such `Effect` has one `EventHook` whose
  `call` is `interpret::<P>` and whose `id` keys the op-list. **This works today
  with no engine edit** — it abuses only the `source_effect` threading the engine
  already does (`dispatch.rs:128`) and the defaulted resolvers
  (`effect_for_*`/`side_effects`/`field_effects`). `Event::Custom(u16)` is reachable
  as data (`on:"Custom(7)"`, `event.rs:148`) so a game can add an interaction point
  with no engine change at all. Cost it admits: `EffectId`-space inflation and the
  per-dispatch **linear arena scan** at `dispatch.rs:183` — fine at minimon scale,
  the trigger to migrate is full-roster scale (§7).

- **Option B — a defaulted runtime-hook seam. [ENGINE-WORK: one additive, defaulted
  method].** Add an optional `EffectProvider` method (same shape as the four
  existing defaulted resolvers, `ctx.rs:131-177`) returning a runtime hook list
  when an effect has no `&'static hooks`; the collector consults it. Keeps
  id↔effect 1:1, avoids the id inflation. It is **one additive defaulted method**:
  every current game and the 88 Gen-1 slices stay byte-identical because the
  default returns "no runtime hooks", reducing the collector to today's
  `push_matching` path (`dispatch.rs:97-132`). Migrate to B when A's arena cost
  bites.

> Note on the *other* designs' bridges, for the record: the embedded-JS designs
> widen `EventHook.call` from a `fn` pointer to an enum
> (`HandlerImpl{ Native(fn) | Script{module,func} }` or
> `HandlerBody{ Native | Runtime(Arc<dyn>) }`) plus a defaulted `script_runtime()`
> provider method. The **index-based** enum (`HandlerImpl` with `module/func`
> indices) is the correct shape — it preserves `Copy`/zero-alloc; the
> `Arc<dyn RuntimeHandler>` variant is **not `Copy`** and forces a per-hook heap
> alloc, regressing the `'static`-const hook-table model (`event.rs:312`). If the
> escape hatch in §7 is ever wired, use the index enum, not `Arc`.

Either way the runtime effect is registered through the **existing** resolvers —
the engine never learns "data exists." The interpreter is the only thing that
knows the op-list; the engine sees an ordinary `Effect` with a `fn`-pointer hook.

---

## 3. Mapping onto Events / RelayVar / HandlerResult / ordering

- **Events.** A hook's `on:` parses straight to the closed `Event` enum
  (`event.rs:34-149`) at **load time**; unknown names fail at load (the closed set
  is the contract that keeps the comparator and parity tests auditable,
  `event.rs:21-27`). `Custom(u16)` is the open tail (`on:"Custom(7)"`).
- **RelayVar.** Numeric ops use the typed accessors and `scale` (`event.rs:170-225`).
  `ScaleRelay → Set(relay.scale(n,d))`; `AddRelay → Set(Int(relay.as_int()+k))`.
  `scale` preserves the lane (`Int`/`Damage`/`Accuracy`), so a data `ModifyDamage`
  op composes with native folds in the same lane — exactly how minimon's Sandstorm
  `WeatherModifyStat` scales the `Int` SpD relay (`lib.rs:556`).
- **HandlerResult.** Each op resolves to one of the four verdicts (`event.rs:230`):
  `VetoIf(true)→Fail` (shows "but it failed!") or `FailSilent`; a numeric op→`Set`;
  a side-effecting op (`DamageFraction`)→`Unchanged`. An op-list short-circuits on
  the first `Fail`/`Set(+fast_exit)` exactly like the native fold
  (`dispatch.rs:285-297`).
- **Ordering.** `order`/`priority` from the data go verbatim into the synthesized
  `EventHook`/`CollectedHandler`, so a data effect interleaves with native effects
  under one `comparePriority` sort: **order → priority → speed → sub_order →
  effect_order** (`dispatch.rs:56-66`). The Leftovers (`order:20`) vs poison-chip
  (`order:10`) cross-source ordering is enforced by the *same* comparator tier the
  native minimon proves (`lib.rs:496,517`; `tests.rs:171` asserts 100 − 12 + 6 =
  94). `sub_order` derives from `kind`'s `EffectType` (`event.rs:262`);
  `effect_order` falls back to the id (`dispatch.rs:111-114`), keeping ties
  RNG-free and deterministic.
- **Re-entry caveat (shared by all three designs).** `HandlerFn` gives
  `&mut BattleCtx` but **not `&P`**, so a handler cannot itself re-enter dispatch.
  The Intimidate→`TryBoost`→Clear-Body-veto cascade is a **driver-orchestration**
  pattern: the `Boost` primitive *records intent*, and the game's driver fires the
  nested `TryBoost` where both contributors are collected and folded in comparator
  order — precisely how minimon does it (`lib.rs:617-685`). The data layer must
  expose nested dispatch *as a primitive* (`Boost`, `InflictStatus`), never as
  free-form re-entry. This is a limit, not a bug (§5).

---

## 4. Determinism & safety

### 4.1 RNG only via `BattleRng`
The engine links **no `rand`** (`rng.rs:5`); all entropy is
`ctx.rng: &mut dyn BattleRng` (`ctx.rs:299`), and draw count/order is load-bearing
for Gen-1 parity (the 1/256 miss, crit rolls, and the per-tie speed-sort byte at
`dispatch.rs:241-262`). The `chance:(n,d)` gate compiles to `ctx.rng.chance(n,d)`
(`rng.rs:61`). **The interpreter has no other entropy source** — no `rand`, no
clock, no pointer hashing — so draw count and order are a *pure function of the
op-list*. A `ScriptedRng` (`rng.rs:76`) replays a data ruleset identically:
determinism is a **structural guarantee, not a review obligation**. This is the
single decisive advantage over the JS path (§4.3).

### 4.2 No code execution
Data *selects + parameterizes* pre-audited Rust ops; there is no `eval`, no
codegen, no FFI. The attack surface is the closed primitive enum, exhaustively
unit-testable (each primitive once, not each move). A malformed record fails at
**load**, never mid-battle. Selectors resolving to a fainted/absent battler are
skipped (mirroring `run_event_checked`'s liveness re-check, `dispatch.rs:331`);
div-by-zero in fractions clamps to `/1` (as `RelayVar::scale` already does,
`event.rs:208`). Reloading replaces the provider's registry between turns; because
effects are addressed by `EffectId` and live state is in the engine's
`EffectState` arena (`ctx.rs:236`) not the data, a reload does not invalidate
in-flight battle state.

### 4.3 The Boa boundary — why the existing script infra is *not* reused
The in-repo Boa integration (overworld map scripts, `jrpg-engine-script`) is
**async by construction**: `await game.showText(...)` mints a `JsPromise`, stores
a `PendingResolve`, and `ScriptEngine::tick()` resolves it on a **later frame**.
`run_event` is the opposite — a **synchronous re-entrant fold that must return
`HandlerResult` now** (`dispatch.rs:285-297`). The async ScriptCommand/promise
bridge therefore **cannot** be reused for battle effects. The recommended
declarative-data layer needs **none** of Boa. The escape hatch (§7) would reuse
the Boa *dependency* but **not** the *integration* — it requires a brand-new
*synchronous* host-call facade (delete `Math.random`/`Date` from the realm; route
all RNG through `ctx.rng`; ban `await`/promises; cap instructions per call,
treating overrun as `Unchanged`). The "we already have Boa" advantage is thus
largely illusory. The map-cutscene line is the only reason §4.3 cross-links
`DEVELOPER_GUIDE.md` at all: *map cutscenes = async commands; battle effects =
synchronous*.

---

## 5. Honest limits

- **Expresses only what the vocabulary anticipates.** Counter (reflect
  `mv.last_damage`, `ctx.rs:286`), Bide accumulation, Substitute HP bookkeeping,
  Trick Room comparator inversion, Future Sight (delayed-turn scheduling),
  Disguise/Sturdy floor-to-1, and anything needing **novel per-effect counter
  state** are **not reachable** until a primitive is added in Rust:
  `P::EffectStateKind` is a compile-time game-supplied enum (`ctx.rs:26,249`) the
  data **cannot extend**. The data layer is a *consumer* of the vocabulary, an
  amortizer of *content*, **not** an extender of *mechanics*.
- **Adding a primitive is still a Rust change** (plus a test). The win is
  amortization: one `InflictStatus` covers hundreds of secondary-effect moves; you
  drop to Rust only for genuinely new *mechanics*, not new *content*.
- **No arbitrary control flow.** Only `chance`, `unless/when` predicates, and the
  native short-circuit. Multi-step stateful sequences (charge-turn lock-in via
  `forced_action`, `ctx.rs:99`; multi-hit loops) need a dedicated parameterized
  primitive or native code.
- **No handler-level re-entry.** Nested dispatch is a *primitive* + driver
  orchestration (§3), never free-form re-entry from inside an op.
- **Two-layer debugging.** A wrong outcome may be in the data *or* the primitive;
  the interpreter **must** log `(EffectId, Event, op, relay before/after)` from day
  one or the data author is pushed back into Rust — defeating the whole point.
- **Option A's arena cost.** One synthesized id per hook inflates the id space and
  the linear arena scan (`dispatch.rs:183`) — the migration trigger to Option B.

---

## 6. POC vs full — the phased plan

**POC (small, 100% [AUTHORING-WORK], NO engine edit — Option A).** Re-express
**exactly minimon's five systems** as one `rules.ron` + the generic `interpret`
`fn`-pointer + a ~15-op interpreter, registered through the existing resolvers.
Then assert the data-driven `Battle` produces **byte-identical `BattleState`
outcomes and identical `ScriptedRng` draw counts** as the native minimon tests
(`examples/minimon/src/tests.rs`). The **single must-pass** assertion is the
cross-source residual ordering — **poison chip (order 10) before Leftovers heal
(order 20)** under one `compare` sort (`tests.rs:171`: 100 − 12 + 6 = 94) —
because it proves data hooks interleave with the comparator *identically to
native*. If the data version replays the same draws and same HP outcomes, the
bridge is proven. Build the `(EffectId, Event, op, relay)` trace into the
interpreter in this same POC.

**Phase 2 [ENGINE-WORK].** Migrate to Option B's one defaulted runtime-hook
method when A's arena scan bites at fuller rosters; size the primitive set against
the *actual* Gen-1 move list (not the demo five) so the vocabulary ceiling is hit
deliberately, not by surprise.

**Phase 3 (full content) [AUTHORING-WORK + occasional ENGINE-WORK].** Author the
Gen-1 move/ability/item/weather tables as data; each genuinely-new mechanic adds
one audited primitive (Rust + test), then unlocks all content that recombines it.

**Phase 4 (escape hatch, optional) [ENGINE-WORK].** If a mechanic is unreachable
even with new primitives, wire the synchronous-Boa facade behind the index-based
`HandlerImpl` enum + defaulted `script_runtime()` (§2.2 note, §4.3) — reserved for
the long tail, kept off the perf-critical parity core.

---

## 7. What stays native (and the escape hatch)

Keep native (`BATTLE_ENGINE_GUIDE.md` path): the **Gen-1 parity core** (draw-order
load-bearing, perf-critical), and any mechanic needing novel `EffectStateKind` or
handler-level re-entry. The **documented escape hatch** for the unreachable long
tail is the synchronous-Boa facade (§4.3) behind the index `HandlerImpl` enum —
designed here, *not* recommended as the default, and determinism-safe **only by
review** (one stray `Math.random` silently breaks replay). Use it when the
vocabulary genuinely can't reach a mechanic; everything else is data.

---

### See also
- [`../BATTLE_ENGINE_GUIDE.md`](../BATTLE_ENGINE_GUIDE.md) — the sibling
  **native-`fn`-pointer** authoring guide this layer sits on top of.
- [`09-battle-engine-generalization-design.md`](./09-battle-engine-generalization-design.md),
  [`10-generalization-result.md`](./10-generalization-result.md) — systems-as-effects + the GO-WITH-NITS result.
- [`11-no-code-effect-authoring-design.md`](./11-no-code-effect-authoring-design.md) — the parallel *hybrid* design (declarative primitives + JS escape hatch in one schema); this doc is the lead-architect pick of declarative-data-first.
- Code (read, not modified): [`examples/minimon/src/lib.rs`](../../examples/minimon/src/lib.rs),
  [`examples/minimon/src/tests.rs`](../../examples/minimon/src/tests.rs),
  [`crates/jrpg-engine/src/battle/stack/{event,dispatch,ctx,authoring}.rs`](../../crates/jrpg-engine/src/battle/stack/),
  [`crates/jrpg-engine/src/battle/rng.rs`](../../crates/jrpg-engine/src/battle/rng.rs).
