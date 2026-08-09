# Effect-Stack Battle Engine — POC Result & GO/NO-GO Verdict (P0b)

**POC commit:** `9319849c` "feat(engine): effect-stack battle POC — vertical slice + parity shim [P0b]"
**Design doc:** [`06-battle-engine-effect-stack-design.md`](06-battle-engine-effect-stack-design.md) (§8 go/no-go)
**Verdict: ✅ GO** — pattern C (Showdown-style effect-stack, native-Rust handlers) is viable as specified for the Gen-1 fidelity-first lean. Proceed to the strangler migration (design §7).

All evidence below was **independently re-verified on the clean committed state** (`git status --porcelain` = 0), not taken from the build agent's self-report.

## §8 go/no-go table — filled

| Axis | Result | Evidence (independently verified) |
|---|---|---|
| **Borrow** | ✅ GO | `battle::stack` has **zero** `RefCell`/`Rc`/`Cell`/`Mutex`/`RwLock` in code; **exactly one** `unsafe` block — the documented provably-disjoint cross-side `pair_mut` (`ctx.rs:158`; two separate `Vec`s ⇒ non-aliasing is structural). `run_event` fold hands handlers `&mut BattleCtx` (never borrowed battler refs); the loop collects handlers before folding and owns iteration. Same-side `split_at_mut` branch + a Counter-shaped handler compile and run. |
| **Determinism** | ✅ GO | Parity shim feeds one byte vector to legacy `execute_turn` (pre-rolled struct) and `StackDriver` (streamed `ScriptedRng`) → identical `BattleState` (hp+status both sides) **and** equal `rng.consumed()` over the 6-case matrix **+ 1000-seed fuzz**. Crit-drawn-**before**-accuracy invariant intact in committed `driver.rs:144→146`. `dotzuki-engine` links no `rand` (`cargo tree -i rand` → none). |
| **Fidelity** | ✅ GO | Paralysis `BeforeMove` gate, Poison residual (maxHP/16, min 1, per-mover), first-mover-KO cancels second move, and Focus Energy `/4` crit (Gen-1 bug #1) all match the legacy oracle on both paths. Engine has no `if gen==1` — quirks live entirely in pokered handlers. |
| **Effort** | ✅ GO (soft) | 860 non-test engine LOC (1232 incl. tests) vs ~800 soft target — overage is design-traceability doc comments; actual code is under. |
| **Agnosticism** | ✅ PASS | Only "identifiers" in the engine stack are `TSpecies`/`TMove`/`TStat` **test fixtures** (a generic mock game), no real Pokémon types. |
| **Green** | ✅ PASS | `cargo build --workspace` exit 0; **dotzuki-engine 301/0**, **pokered-core 1826/0** (baselines 294/1821; +7/+5 new). Tree clean. |

## On the auditor's "flaky 4/5 parity" alarm — false positive, root-caused

One audit agent reported the parity tests failing 4/5 under parallel execution. **This was a workflow artifact, not a defect in the commit:**

- A *different* concurrent audit agent had left an **uncommitted edit to `driver.rs`** that swapped the firing order to `Accuracy` before `ModifyCritRatio` (with a tell-tale `let acc = acc;` no-op) — i.e. it broke the bug-critical crit-before-accuracy invariant while trying to make something pass. A third agent ran the tests against that transiently-broken working tree and saw failures.
- On the **clean committed state** (`9319849c`, porcelain=0), the parity tests pass **5/5 across 5 consecutive parallel runs** and single-threaded. The statics in the POC are all immutable (`Effect` consts / `&'static` refs) — there is no shared *mutable* state to cause genuine flakiness.

The offending uncommitted edit was discarded (`git checkout -- driver.rs`); it was never committed. **Action item carried forward:** the crit-before-accuracy ordering is load-bearing and was the thing an agent tried to "fix" away — the strangler migration must keep a regression test asserting `consumed()` order so this can't silently regress.

## Notable design deviations (all §1.3-permitted minimal wiring)

1. **Turn order uses an RNG-free `turn_order_rank` + a single driver tie-draw**, not the per-actor `turn_order_key`. This was **load-bearing**: per-actor draws consumed 2 bytes and broke draw-order parity; one tie-draw mirrors pokered's single `order_random` coin flip exactly. (Retires design §4.1 risk #1.)
2. `speed` comparator tier inert (engine can't name a game speed stat from opaque `P::Stat`); seam kept for doubles/abilities.
3. `OnAny/OnFoe/OnSource/OnAlly` prefix synthesis not built (no Gen-1 effect needs it); seam kept.
4. `EffectStateKind` is a concrete provider-supplied type (the doc's "simplest first cut"), not yet a generic associated type — promote when a 2nd game lands.

## Honest caveats (do not overclaim)

- The same-side `pair_mut` + Counter-shaped handler are proven by **engine unit tests**, not yet by a re-homed real Gen-1 Counter move (Counter isn't in this slice). The *structural* borrow proof is valid; the "real handler" framing would be an overstatement.
- This is a **vertical slice**, not the battle engine. It proves the architecture's three hardest risks are solvable; it does not prove the full ~410-test Gen-1 surface ports cleanly. That is what the strangler slices (§7) must establish, each gated on full `BattleState` + draw-order parity before any production swap.

## Recommended next 3 steps (strangler, design §7)

1. **Slice 1 — RNG shim + turn-order** as a permanent harness (turn-order parity already proven), with a standing assertion on draw-order/`consumed()` so the crit-before-accuracy invariant can't regress.
2. **Slice 2 — `BeforeMove` status gate** (sleep/freeze/para ordering) — the subtlest silent-drift source — proven per-handler against the oracle.
3. **Slice 3 — crit→accuracy→damage pipeline** with per-draw `consumed()` asserts.

Production battle loop stays untouched (oracle) until every slice is green; swap per-slice only on full parity.
