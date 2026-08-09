# 16 — Synchronous Script Escape Hatch — design

> **DECISION (2026-06): NOT ADOPTED — keep the ~5 data-reach moves native.** Per §7.1's honest
> alternative, the project chose to ship Transform/Metronome/Mimic/MirrorMove/Conversion as ~5 small
> native `Event::Custom` handlers rather than build this synchronous-script facade. Rationale: it keeps
> battle determinism **100% structural** (no by-review RNG path), adds **zero** Boa-in-battle dependency,
> and minimizes the audit surface. The only thing forgone is the headline "100% zero-Rust migration";
> capability is unaffected (all 165 moves still migratable — 5 just stay native, not script).
> This design is **preserved, not deleted**, so the decision stays revisable if a future game needs
> author-supplied arbitrary move logic. Everything below is the (unadopted) design as researched.

**Status:** DESIGN / DOCS ONLY. No code changes. Decision-oriented; approve before any work.
**Scope:** Design a **synchronous script escape hatch** for the battle effect-stack so the
*long-tail pure-logic* moves — the ~5 "data-reach" moves the closed declarative op-vocabulary
cannot express and that are not worth a bespoke Rust primitive — can be authored **without
Rust**. With this hatch in place, **all 165 Gen-1 moves are migratable**: none must stay
hand-written-in-Rust-forever.
**Predecessors:** `11` (no-code authoring; §2.2 the index `HandlerImpl` enum, §4.3 the Boa
async-vs-sync boundary, §6 Phase 4, §7 the escape hatch) and `15` (the migration blueprint
this doc completes — see the revised end-state table + P7 there).
**This doc settles** the hatch that `11 §2.2/§4.3/§6-Phase-4/§7` only *sketched*, and is the
companion `15` cross-links from its end-state.

---

## 0. The goal, in one paragraph

The declarative path (`11`) plus Rust primitives + game-side `EffectStateKind` state-slots
(`15 §3`) covers **160 of 165 moves** without per-move Rust. What is left is a handful of
moves whose behavior is *arbitrary pure logic over game data* the closed op-vocabulary was
deliberately not built to express: **Transform, Metronome, Mimic, MirrorMove, Conversion**.
Each is one-off — adding a Rust primitive for each buys nothing reusable, and forcing them
into the declarative DSL would make the DSL reach `P::Species` / the move table and break the
engine's game-agnostic invariant (`15 §6` non-goal). The escape hatch lets these ~5 be
authored as **synchronous, sandboxed script** at the *edge* of the system — explicitly **the
last resort, never the default**. The non-negotiable: the **determinism core stays sacred**.
The ~497 battle tests and the Gen-1 byte-exact RNG draw order MUST NOT depend on script;
script is isolated off the parity-critical and perf-critical path.

---

## 1. Why a synchronous facade (not the existing Boa, not a new primitive)

Three facts force the shape of this hatch; all three are verified in-repo, not assumed.

**(1) Engine handlers are zero-capture `fn` pointers folding a `RelayVar` synchronously and
returning a `HandlerResult` NOW.** The fold's only call site is
`(h.call)(ctx, relay, h.target, h.source, h.source_effect)` where `call: HandlerFn<P>` is a
`Copy`, `'static`, zero-alloc `fn` pointer (`dispatch.rs` `run_event`/`run_event_checked`;
`CollectedHandler.call`). The fold immediately matches the returned `HandlerResult`
(`Unchanged`/`Set`/`Fail`/`FailSilent`) and either continues, replaces the relay, or
short-circuits. There is **no point at which the fold can yield and resume later**.

**(2) The in-repo Boa integration is ASYNC by construction and CANNOT be reused as-is**
(`11 §4.3`). `jrpg-engine-script` is built for map cutscenes: an awaited host call
(`await game.showText(...)`) mints a `JsPromise`, stores a `PendingResolve`, and
`ScriptEngine::tick()` resolves it on a **later frame**. That is the exact opposite of a
synchronous re-entrant fold that must return a verdict in the same call. The async
ScriptCommand/promise bridge is therefore unusable inside `run_event`. The "we already have
Boa in-repo" advantage is largely *illusory* — we reuse the Boa **dependency** (the JS
engine), not its **integration** (the async tick loop).

**(3) These ~5 moves are not worth a bespoke Rust primitive.** A primitive earns its keep by
*amortization* — one `InflictStatus` covers hundreds of moves (`11 §5`). Transform / Metronome
/ Mimic / MirrorMove / Conversion each recombine *nothing*; each is a one-off touching
`P::Species` / the move table / a foe's last move. They are exactly the "genuinely novel
mechanic the vocabulary can't express" case `11 §7` reserves the hatch for.

> Decision (settled by the user): the script hatch is for **LONG-TAIL LOGIC ONLY** — these
> ~5 data-reach moves. **Everything else stays declarative RON data + Rust primitives +
> `EffectStateKind` state-slots.** Script is the edge, not a parallel authoring system.

---

## 2. The model — `HandlerImpl`: an op-list, OR a script

The declarative loader (`11 §2.1`) maps every data hook to **one** generic interpreter
`fn`-pointer, `interpret::<P>`, keyed by the `EffectId` the engine already threads to each
handler as `source_effect`. The escape hatch is the *second* arm of the same fan-in: a hook
maps either to the op-list interpreter **or** to the script runtime.

`11 §2.2` (note) already chose the correct shape and rejected the wrong one:

```rust
// The widened call slot. Keep it COPY + 'static — indices, never an Arc<dyn>.
//   (Arc<dyn RuntimeHandler> is NOT Copy and forces a per-hook heap alloc,
//    regressing the 'static-const zero-alloc hook table — 11 §2.2 rejects it.)
enum HandlerImpl<P> {
    Native(HandlerFn<P>),          // today's zero-capture fn pointer (UNCHANGED default)
    Script { module: u16, func: u16 }, // index into the game's script table
}
```

- The **declarative** path already collapses to `Native(interpret::<P>)` keyed by `EffectId`
  (`11 §2.2 Option A`) — no engine change. A **script** hook collapses to
  `Script{module,func}` resolved through the same `EffectId` keying.
- The `jrpg-rules` loader maps a data hook to one `interpret()` fn keyed by `EffectId`; a
  **script** hook maps to a `Script` `HandlerImpl` instead — same loader, same `EffectId`
  space, same collector, same comparator sort (`order → priority → speed → sub_order →
  effect_order`). A scripted effect interleaves with native + data effects under the *one*
  `compare` sort, identically to `11 §3`.
- The verdict contract is unchanged: a script hook returns a `HandlerResult` — `Set(relay)`,
  `Fail`, `FailSilent`, or `Unchanged`. The fold never learns the verdict came from script.

This is purely **additive**: `HandlerImpl::Native` is today's behavior verbatim; if no game
registers a `Script` arm, the enum is a one-variant pass-through and every existing fold is
byte-identical (see §6, the seam).

---

## 3. The synchronous sandbox facade

The facade is a **brand-new synchronous Boa host** — *not* `ScriptEngine`. It is built to be
called *inside* a fold and return *in the same call*. Per `11 §4.3`, it strips
nondeterministic entropy from the realm and routes all randomness through `ctx.rng`.

### 3.1 The realm is built sterile (structural determinism)

When the script runtime is constructed, the JS realm is created with all entropy and I/O
globals **removed**, not merely shadowed:

- **Delete the JS RNG.** `Math.random` is removed from the realm (delete the property; do not
  leave a callable stub). A script that names `Math.random` is a **load-time error**, not a
  silent nondeterministic draw.
- **Delete the wall clock.** `Date` (and `Date.now`), `performance.now`, any timer
  (`setTimeout`/`setInterval`) — removed. There is no readable clock in the realm.
- **No promises / no async.** `Promise` is removed and `await` is a parse error in the
  facade's compilation mode. A script hook is a plain synchronous function; there is no event
  loop, no `tick`, nothing to resume. (This is the bright line from the async overworld Boa.)
- **No ambient I/O.** No `fetch`, no console-to-network, no module loading from disk at battle
  time (modules are pre-loaded + frozen at ruleset load).

### 3.2 The host API is synchronous and entropy-routed

The only capabilities a battle script gets are a **closed, synchronous** host object bound
into the realm — the script-facing mirror of `BattleCtx`:

- **`ctx.rng` is the only randomness.** All draws go through the engine's
  `BattleRng` (`ctx.rng: &mut dyn BattleRng`). The host exposes
  `host.rng.range(bound)` / `host.rng.chance(num, den)` / `host.rng.nextU8()` that call
  straight through to `ctx.rng`. Because `range`/`chance` derive from `next_u8`
  (`rng.rs`: `chance(n,d) = range(d) < n`, `range(b) = next_u8() % b` for `b ≤ 256`), a
  script draw is **byte-indistinguishable** from a native draw at the same ordinal. A
  `ScriptedRng` replays a scripted move identically to a native one.
- **Reads:** species/types/stats/stat-stages/status/move-slots/last-move/PP of `Host`/`Foe`,
  the move table (read-only), `mv.last_damage`, the active relay value.
- **Writes (all synchronous, all through `ctx`):** the same op surface the declarative layer
  has — set/clear a volatile (`EffectStateKind`), set HP, set damage relay, set a move slot,
  set types, inflict status, boost — exposed as host *functions* that mutate only through
  `ctx` (`battler_mut`/`pair_mut`/`effect_mut`). No host function returns a promise.
- **Return:** the script returns one of the four verdict shapes; the facade maps it to
  `HandlerResult`. A script that returns nothing / `undefined` maps to `Unchanged`.

The host object captures **nothing** beyond a `&mut BattleCtx` for the duration of the one
call (mirroring `interpret::<P>`), so the collect→snapshot→fold borrow discipline
(`dispatch.rs`) is untouched: no `RefCell`, no `Rc`, no new `unsafe`.

### 3.3 The instruction cap (overrun ⇒ `Unchanged`)

The facade runs the script under a **bounded instruction budget** (Boa supports a step/budget
limit). If a call exceeds the cap, the facade **aborts the call and returns `Unchanged`** —
the relay passes through untouched, identical to a no-op handler. This guarantees a script
hook **cannot hang the synchronous fold** and **cannot consume unbounded entropy** (a runaway
loop drawing `ctx.rng` is bounded by the step cap). The cap is a fixed engine constant chosen
well above the worst legitimate script (Metronome's single move-pick) and is part of the
determinism contract: the *same* script on the *same* `ctx`/`rng` either completes within the
cap deterministically or deterministically returns `Unchanged` — never "sometimes both."

### 3.4 No code execution beyond the realm; load-time validation

Scripts are *selected + parameterized* JS over a closed host API — but unlike the declarative
op-list they *are* code, so the safety story is weaker by exactly that amount (honestly
stated in §4). Mitigations: the realm is sterile (§3.1); the host API is closed (§3.2);
compilation happens at **ruleset load** (a parse/forbidden-global error fails at load, never
mid-battle); modules are frozen after load so a reload swaps the table between turns without
invalidating in-flight `EffectState` arena entries (addressed by `EffectId`, `11 §4.2`).

---

## 4. The determinism contract — honest: structural vs by-review

Determinism is the load-bearing Gen-1 contract. For the script path it is enforced
**structurally where possible** and **by-review otherwise**, and we state the line honestly.

### 4.1 What is STRUCTURAL (enforced by construction, not trust)

- **No JS entropy reaches the realm.** `Math.random`/`Date`/timers are *deleted*, so a script
  *cannot* draw nondeterministic randomness even by mistake — naming them is a load-time
  error (§3.1). This is the decisive upgrade over `11 §7`'s "by review only" framing for the
  old escape hatch: the entropy globals are gone, not policed.
- **All randomness is `ctx.rng`.** The only draw primitive is the engine `BattleRng`, so a
  scripted draw is at a `ScriptedRng`-replayable ordinal, byte-identical to native (§3.2).
- **No async / no later-frame resolution.** No promises, no `tick` — the script cannot defer
  work to a frame where a different RNG state exists (§3.1). The result is a pure function of
  `(script, ctx, rng-stream)`.
- **Bounded execution.** The instruction cap makes draw *count* bounded and the overrun
  outcome deterministic (`Unchanged`, §3.3).
- **Off the parity-critical path.** Only the ~5 scripted moves route through the facade; the
  ~160 declarative+native moves and the entire turn-order / crit / accuracy / damage pipeline
  never touch script. The 497 tests and the 88 Gen-1 slices exercise the native+data path and
  are byte-identical (§6).

### 4.2 What is BY-REVIEW (documented honestly — not pretended away)

- **Draw *order* inside a script is the author's responsibility.** Structural stripping
  guarantees *which* RNG (`ctx.rng`) and *bounded count*; it does **not** guarantee the script
  draws in the Gen-1 *order*. Metronome must draw its move-pick byte at the exact ordinal the
  native Metronome would, or it desyncs the shared stream for the rest of the turn. This is a
  **review + test** obligation, not a structural one. Mitigation: each scripted move ships a
  `ScriptedRng`-pinned draw-order test in the differential harness (`15 §4`), same gate as the
  native effects.
- **Op-equivalence of the host writes is by-review.** That a script's `setMoveSlot` /
  `setTypes` reproduce the exact Gen-1 quirk (e.g. Transform copying stat *stages* too,
  Mimic's PP handling) is verified by parity tests, not by the type system.
- **Boa version pinning.** Float/string/iteration-order semantics across Boa upgrades are a
  review item; the facade pins the Boa version and the determinism tests are the regression
  gate. (The declarative path has *no* such exposure — another reason script is the edge.)

**The honest summary:** the *engine boundary* is structural (no entropy, no async, bounded,
`ctx.rng`-only); the *per-script correctness + Gen-1 draw-order fidelity* is by-review,
backed by per-move `ScriptedRng` parity tests. We do not claim the script path is as
structurally safe as the declarative op-list — it is not, and that is precisely why it is the
last resort (§7).

---

## 5. The 5 data-reach moves as example scripts

Illustrative, not final API. Each is a single synchronous hook returning a `HandlerResult`.
All randomness is `host.rng`; all reads/writes go through the closed host (§3.2).

```js
// Metronome (0x53): pick a random move 1..165, skip self, re-dispatch it.
// ONE rng draw, at the Metronome ordinal — the draw-order review obligation (§4.2).
function metronome(host) {
  let id;
  do { id = 1 + host.rng.range(165); } while (id === host.moveTable.METRONOME);
  return host.callMove(id, host.Host, host.Foe);   // synchronous re-dispatch via the host
}

// Transform (0x39): copy foe's species, types, stats, stat-stages, and move slots.
function transform(host) {
  const foe = host.read(host.Foe);
  host.setSpecies(host.Host, foe.species);
  host.setTypes(host.Host, foe.types);
  host.copyStats(host.Host, foe);           // incl. stat STAGES (Gen-1 quirk — by-review)
  host.setMoveSlots(host.Host, foe.moves.map(m => ({ id: m.id, pp: 5 })));
  host.setVolatile(host.Host, "Transformed");
  return host.unchanged();
}

// Mimic (0x52): copy one of the foe's moves into the chosen Mimic slot.
function mimic(host) {
  const foe = host.read(host.Foe);
  const pick = foe.moves[host.rng.range(foe.moves.length)];   // one draw, Mimic ordinal
  host.setMoveSlot(host.Host, host.mv.slotIndex, { id: pick.id, pp: pick.pp });
  return host.unchanged();
}

// Mirror Move (0x09): re-dispatch the foe's last-used move; fail if none.
function mirrorMove(host) {
  const last = host.read(host.Foe).lastMove;
  if (!last) return host.fail();                 // "but it failed!"
  return host.callMove(last, host.Host, host.Foe);
}

// Conversion (0x18): copy the foe's type(s) onto self. No rng.
function conversion(host) {
  host.setTypes(host.Host, host.read(host.Foe).types);
  return host.unchanged();
}
```

Note each is *exactly* the "reaches `P::Species` / move table / foe last-move" logic `15 §2`
classes as data-reach. None recombines a reusable primitive; none is expressible in the closed
op-vocabulary; all are pure logic at the edge.

---

## 6. The engine seam — game-agnostic, additive, defaulted

The engine stays **game-agnostic + additive + defaulted**. The seam defaults to "no script
runtime," so existing games, the 497 tests, and the 88 slices are byte-identical.

- **`HandlerImpl` enum (additive).** Widen the hook's `call` slot from `HandlerFn<P>` to the
  `HandlerImpl<P>` enum (§2). `Native(fn)` is today's path verbatim; the fold matches the enum
  and, for `Native`, calls the `fn` exactly as now. **Keep it `Copy` + `'static`** — indices,
  never `Arc<dyn>` (`11 §2.2`). With no game registering a `Script` arm, this is a one-variant
  pass-through; the generated code for the existing fold is unchanged.
- **`script_runtime()` defaulted provider method (additive).** A new `EffectProvider` method
  (same shape as the four existing defaulted resolvers, `ctx.rs`) that returns the game's
  synchronous script runtime, **defaulting to `None`**. The fold consults it only when it
  encounters a `Script` `HandlerImpl`. Default `None` ⇒ the facade is never constructed, links
  no Boa, and is impossible to reach ⇒ every current game / test / slice is byte-identical.
  pokered overrides it to return the sterile facade; minimon and the template leave it
  defaulted.
- **No `rand` in the engine.** The facade routes through `BattleRng` (the engine still links
  no `rand`, `rng.rs`); Boa is a dependency of the *game's* runtime, behind the defaulted
  method — the engine core does not pull Boa unless a game opts in.
- **`Event::Custom(u16)` reachable from script** (`event.rs`), so a game can add a scripted
  interaction point with no engine change beyond the two seams above.

Net engine surface: **one widened (additive, `Copy`) call slot + one defaulted provider
method.** Both default to today's behavior. This is the minimum that lets a *game* opt into
script while the *engine* learns nothing Pokémon-specific.

---

## 7. Honest limits — and why this is the LAST resort, not the default

- **Determinism is weaker than the declarative path.** The op-list path is determinism-safe
  *by construction* (`11 §4.1`): a closed enum, no `eval`, draw count/order a pure function of
  the data. The script path is structural *at the boundary* but **by-review for per-script
  correctness and draw order** (§4.2). That is a real downgrade; it is acceptable *only*
  because it touches ~5 moves at the edge.
- **Two-layer-plus debugging.** A wrong outcome can be in the script, the host binding, or the
  primitive it calls. The facade must log `(EffectId, Event, host-call, relay before/after,
  rng-bytes-drawn)` from day one, or the author is pushed back into Rust (the `11 §5` warning,
  amplified for script).
- **Attack/audit surface.** A closed op-enum is exhaustively unit-testable (each op once); a
  script is arbitrary code. The sterile realm + closed host bound the surface, but it is
  strictly larger than the declarative path's.
- **Boa version exposure.** A maintenance dependency the declarative path does not have (§4.2).
- **Therefore: last resort.** Use the hatch **only** when (a) the closed op-vocabulary
  genuinely cannot express the mechanic, **and** (b) no reusable Rust primitive is justified.
  Everything that recombines is data; everything that needs novel state is a Rust primitive +
  `EffectStateKind` slot; only the irreducible pure-logic long tail is script.

### 7.1 The honest alternative: "or just keep these 5 native"

The critique's strongest counter is worth stating plainly: **these 5 moves could simply stay
native `Event::Custom` handlers forever** (exactly `15`'s pre-revision C-tier conclusion).
That alternative:

- **Pros:** zero new engine seam, zero Boa-in-battle dependency, determinism stays 100%
  structural across *all* moves, smallest audit surface, no Boa-version maintenance. The 5
  native handlers already have a clear home (`Event::Custom`) and would be ~5 small, tested,
  one-off Rust functions.
- **Cons (the case *for* the hatch):** the migration headline "all 165 moves migratable
  without Rust" stays *false* — 5 moves are permanently hand-written-in-Rust. For a project
  whose thesis is "author content without writing Rust," that residue is the difference
  between "mostly" and "completely." The hatch closes it at the cost of a small, defaulted,
  edge-isolated seam.

**This document recommends building the hatch** (it completes the migration thesis) **but
records that keeping the 5 native is a legitimate, lower-risk choice** — and that the *only*
thing the hatch buys over "keep 5 native" is the completeness claim, not capability. If the
seam's determinism-by-review cost is judged too high at review time, "keep 5 native" is the
correct fallback and loses nothing but the headline. The user's standing decision is to design
the hatch; this section preserves the alternative so that decision stays revisable.

---

## 8. POC spec

**Goal:** prove the synchronous facade is deterministic and *truly* off the parity core, by
re-expressing **ONE** data-reach move as a script and showing nothing else moves.

**Choice: Metronome (0x53).** It is the cleanest single-draw case (pick a move 1..165, skip
self, re-dispatch) — it exercises the one load-bearing risk (a script `rng` draw landing at a
`ScriptedRng`-replayable ordinal) without the multi-field copy of Transform.

**Deliverables.**
1. The `HandlerImpl::Script` arm + a defaulted `script_runtime()` returning `None` (engine);
   pokered overrides it to the sterile facade (§3). minimon/template stay defaulted.
2. The sterile-realm facade: realm built with `Math.random`/`Date`/timers/`Promise` deleted;
   the closed synchronous host (§3.2) with `rng` routed to `ctx.rng`; the instruction cap with
   overrun ⇒ `Unchanged` (§3.3).
3. `metronome.js` (§5) registered as a `Script` hook keyed by Metronome's `EffectId`.

**Must-pass assertions.**
- **A. Deterministic `ScriptedRng` replay.** Run scripted Metronome twice on the *same*
  `ScriptedRng` byte vector; assert **byte-identical `BattleState` outcome and identical
  `consumed()` draw count** both runs. Then assert the scripted run's draw at the Metronome
  ordinal **equals** the native Metronome's draw at that ordinal on the same byte vector
  (draw-order parity, §4.2) — i.e. the picked move + the resulting turn are byte-identical to a
  native Metronome run through the differential harness (`15 §4`).
- **B. The 497 tests stay byte-identical.** With `script_runtime()` defaulted to `None` for
  every non-pokered path and the Metronome script gated behind the pokered facade, the full
  `cargo test` suite (497 battle tests) is unchanged — no expected byte is re-baselined.
- **C. The 88 Gen-1 slices stay byte-identical.** The slices exercise the native+data fold and
  never touch the facade; assert identical `consumed()` and event streams. This is the
  structural "off the parity core" proof: the facade can be present and the parity core does
  not observe it.
- **D. Sterility is enforced.** A negative test: a script naming `Math.random` (or `Date`, or
  using `await`) **fails at load**, not at battle time.
- **E. The cap is deterministic.** A script that loops past the instruction cap returns
  `Unchanged` deterministically (relay passes through), proving overrun cannot hang the fold or
  consume unbounded entropy.

If A–E pass, the hatch is proven: deterministic, replayable, sterile, bounded, and provably
**off** the 497-test / 88-slice parity-critical path — and Metronome is the first of the 5
authored without Rust.

---

### See also
- [`11-no-code-authoring-design.md`](./11-no-code-authoring-design.md) — §2.2 (the index
  `HandlerImpl` enum vs the rejected `Arc<dyn>`), §4.1 (declarative structural determinism),
  §4.3 (the Boa async-vs-sync boundary), §6 Phase 4, §7 (the escape hatch this doc settles).
- [`15-pokered-migration-blueprint.md`](./15-pokered-migration-blueprint.md) — the migration
  this completes: the revised end-state table (data / primitive / native-state-slot / script
  split) and **P7**, the script-escape-hatch phase.
- Code (read, not modified):
  [`crates/jrpg-engine/src/battle/stack/{dispatch,event,ctx,authoring}.rs`](../../crates/jrpg-engine/src/battle/stack/),
  [`crates/jrpg-engine/src/battle/rng.rs`](../../crates/jrpg-engine/src/battle/rng.rs) (`BattleRng`/`ScriptedRng`),
  [`crates/jrpg-engine-script/`](../../crates/jrpg-engine-script/) (the **async** overworld Boa — the deliberate non-reuse).
