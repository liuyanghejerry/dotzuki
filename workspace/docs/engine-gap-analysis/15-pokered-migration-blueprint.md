# 15 — pokered Gen-1 Battle Migration Blueprint

> **DECISION (2026-06): the script-hatch tier is NOT adopted — those ~5 moves stay native.**
> Where this doc says the ~5 "data-reach" moves (Transform/Metronome/Mimic/MirrorMove/Conversion)
> are authored via the synchronous script escape hatch (`16`) / phase **P7**, read instead:
> they ship as **~5 small native `Event::Custom` handlers** (≈19 native total, no script tier).
> Rationale (see `16` §7.1): keeps battle determinism 100% structural, zero Boa-in-battle dependency.
> Capability is unchanged — all 165 moves still migratable; 5 just stay native, not script.
> **P7 is therefore dropped**; the migration ends at P6. The script design (`16`) is preserved but unadopted.

**Status:** DESIGN / BLUEPRINT. No code changes. Decision-oriented; approve before any work.
**Scope:** Migrate the pokered Gen-1 single battle onto the `dotzuki-engine` effect-stack
(`battle::stack` / `StackDriver`) and author its moves in the `dotzuki-rules` RON DSL,
while the legacy `apply_move_effect` dispatcher stays the green parity oracle through every phase.
**Predecessors:** see `06` (effect-stack design + 30-quirk bug catalog), `11`/`14` (RON loader),
`12` (type chart). This doc supersedes their migration-sequencing notes for the *pokered* swap.

---

## 0. BUILD STATUS LEDGER (live)

> Updated 2026-06. The strangler build is **complete through the test-side phases**; the
> production flip (P6) is the remaining work and is larger than the "final phase" framing
> implied — see the honest scope below.

| Phase | What | State | Commit |
|---|---|---|---|
| **P0** | `BattleRng` shim — pre-roll byte order incl AI prefix | ✅ green | `ec5e1eec` |
| **P1** | pure-damage + self-Boost as RON, routed through the stack | ✅ green | `b67a3568` |
| **P2** | side-status (25) + drain/recoil (10) | ✅ green | `d999fadc` |
| **P3** | special/fixed/OHKO (11) + foe stat-down nested-veto (13) | ✅ green | `eaf74ba9` |
| **P4** | multi-hit (10) via the game-side `RepeatHits` seam | ✅ green | `94a74166` |
| **P5** | native tier — field/volatile/data-reach + the `on:Miss` engine seam | ✅ green | `dd9e41cb` |
| **P5b** | cross-turn lock-in group consolidated into the P5 ledger | ✅ green | *(this commit)* |
| **P6** | flip the production loop to event-replay (the real swap) | ⏳ in progress | — |

**P5b resolution (honesty note).** The cross-turn lock-in group — Charge / Fly / Trapping /
Thrash / HyperBeam / Bide + the reactive Counter / Rage — already has its EXHAUSTIVE
differential proof in `stack_slice6` (the `stack_parity` harness: the `forced_action` seam +
the `EffectState` arena, fuzzed over 1000 seeds vs `legacy_single_turn_damage`). Re-authoring
those handlers in the p5-file style would *duplicate that proof verbatim*, so P5b does **not**.
It instead adds ONE consolidation test (`p5b_lockin_group_differential_consolidation`) that
drives every lock-in shape through the proven harness and re-asserts per-turn damage parity vs
the legacy oracle — a single honest witness in the P5 ledger. The PRODUCTION lock-in handlers
(moving these off `#[cfg(test)]` into the live `PokeredRules` provider with a real
`forced_action`) belong to **P6**, not a separate test-side phase.

**P6 honest scope (re-measured 2026-06).** P6 is **not** a ~200-line adapter; it is a
**~2,500–4,000-line production UI integration**, because:
1. **`StackDriver` returns only `StackTurnResult { first, second_cancelled }`** (`driver.rs:30`)
   — no event/text stream. The live battle screen is frame-stepped and imperative: it shows a
   `Vec<String>` of text ("X used Y!", "Critical hit!", "It's super effective!", "X fainted!")
   paginated through the `ShowingText` phase, advanced on A-press. There is **no event queue**
   today; `format_move_outcome` builds the strings directly from the legacy apply.
2. So the **keystone first slice (P6a)** is a *generic, game-agnostic* engine **turn-event log**
   (additive + defaulted: no log ⇒ byte-identical, existing 497 tests + 88 slices untouched).
   Handlers/driver record structured `TurnEvent`s (MoveUsed / Missed / Crit / Damage{who,amount,
   effectiveness} / StatusInflicted / StatChanged / Healed / Fainted …) keyed by generic
   `P::Move` / `P::Status` / `BattlerRef`. This is legitimately an *engine* feature (minimon needs
   it too — every game must render "what happened"), not pokered-specific.
3. **P6b** then adds a pokered-side translator (`TurnEvent` → the existing `Vec<String>`) and
   routes `execute_turn_with_move` / `execute_second_move` through `StackDriver` + the log, with
   the legacy loop retained as a fallback behind a guard until proven in real play. The
   irreversible final cut (defaulting production to the stack, deleting `execute_second_move`)
   is the last step and must keep the ~226 orthogonal tests (menu 57 / AI 62 / experience 33 /
   settlement 28 / escape 17 / capture 15 / wild 14) green.

**P6b shadow proof (done) + the gap it surfaced.** Per the chosen low-risk path, a SHADOW
PROOF (`p6_shadow_turnlog_narrates_real_gen1_turns`, in `pokered_rules/tests.rs`) drives real
Gen-1 turns (pure damage, super-effective, crit, self-buff, paralysis secondary, KO) through
`StackDriver::execute_turn_logged` and asserts the `TurnLog` faithfully narrates the LEGACY
oracle's outcome (net damage, faint, status, stat-stage, crit, move-used) — proving the
state↔`PokeredRules` mapping AND the log are trustworthy enough to drive the UI, with **zero
production code touched**. It surfaced a concrete **P6b prerequisite**:

> **GAP (NOW CLOSED, Option A) — status residual + pre-move gates are on the stack.**
> *Stage 1:* `PokeredRules::effect_for_status` returns flat burn/poison residual effects
> (`(max/16).max(1)`), and Toxic/Leech residuals are wired through `effect_for_volatile`, so the
> driver's per-mover residual aggregation chips burned/poisoned/toxic/seeded mons at full legacy
> parity (poison flat skips when a Toxic volatile is live — one chip, not two).
> *Stage 2:* the four Gen-1 `BeforeMove` gates — sleep (wake-loses-turn #8), freeze (always-blocks
> #10), paralysis (25% full-para), confusion (50% typeless self-hit) — are re-homed from the
> proven `stack_parity` POC onto every `PokeredRules` move effect (orders 10/20/70/90 = the ASM /
> `MoveRandoms` field order; inert when the mover has no status, so all P1–P5 scenarios stay
> byte-identical). The differential harness's `build_stream` predictor now models a second mover
> paralyzed mid-turn by the first mover's move (Thunder Wave / Body Slam), incl. the
> Substitute-blocks-the-status case. Direct driver tests pin each gate firing on the real
> provider. **pokered-core 1682/0.** With this, burned/poisoned/asleep/frozen/paralyzed/confused
> turns route through the stack at parity — the P6b production flip's stack-coverage prerequisite
> is met.

---

## 1. Executive summary

The honest reachable end-state is a **four-tier split of the 165 moves** — and **with the
script escape hatch (`16`), ALL 165 moves are migratable**: none MUST stay
hand-written-in-Rust-forever. (~14 still need a Rust state-slot + native handler, and ~5 use
the synchronous script facade; everything else is declarative RON + reusable primitives.)

| Tier | Moves | What it means |
|---|---|---|
| **Pure DSL** | **~48** | Entire behavior authored in `rules.ron` with today's closed op vocab + the fired `Effectiveness` fold. 31 plain-damage + Swift + 11 self-Boost + Drain + Recoil + PayDay + Splash + Recover/Softboiled. |
| **DSL-declarative shell + reusable primitive** | **~98** | Power/type/accuracy/category + the `chance` secondary expressed in RON, but the rider needs a *new* reusable primitive (`HasVolatile`, `MoveTypeIsDefenderType`, `RepeatHits`, `SetDamage`, …) before it is data. Includes all 25 side-status moves and the 13 foe stat-down moves. |
| **Native state-slot** | **~14** | Stays a hand-written `&'static Effect` handler **because it needs an `EffectStateKind` state-slot or a cross-effect interceptor** — NOT script. Turn-spanning state (Bide/Charge/Fly/Trapping/Thrash/HyperBeam), cross-effect interceptors (Substitute/LeechSeed/Rage), field flags (Mist/FocusEnergy/Reflect/LightScreen), Haze, Rest, Disable, Teleport/Roar/Whirlwind, and the reactive Counter. These are pure Rust + a game-side `EffectState<P>` arena entry; the script hatch does **not** apply (the determinism core is sacred and these are on the cross-turn / interceptor path). |
| **Script-hatch (data-reach pure logic)** | **~5** | Authored as **synchronous sandboxed script** (`16`), not Rust: **Transform / Metronome / Mimic / MirrorMove / Conversion** — pure arbitrary logic over `P::Species` / the move table / a foe's last move that the closed op-vocabulary cannot express and that is not worth a bespoke Rust primitive. Routed through the sterile Boa facade (entropy globals stripped, `ctx.rng`-only, no awaits, instruction cap ⇒ `Unchanged`), isolated at the edge **off** the parity-critical/perf-critical path. |

The **~19 native tier from the prior revision SPLITS** into **~14 native state-slot** (need a
Rust `EffectStateKind` slot + native handler) **+ ~5 script-hatch** (pure-logic data-reach,
now scriptable). By `MoveEffect` *variant* (82 total, 68 live): **20 DSL-ready, 34
need-new-primitive, 22 native-state-slot, 5 script-hatch, 1 split (Heal=A+C).**
The "~146 become RON" framing from the working notes is corrected here: ~146 can have their
*declarative skeleton* in RON; only ~48 are *fully* RON.

**Determinism core is sacred (the standing invariant).** The ~497 battle tests and the Gen-1
byte-exact RNG draw order MUST NOT depend on script. The script facade is additive + defaulted
to "no script runtime," so existing games / the 497 tests / the 88 slices stay byte-identical
(`16 §6`); script is isolated at the edge, off the parity-critical/perf-critical path
(`16 §4`).

**Headline recommendation.** Do a **strangler-fig, per-effect-group** migration behind the existing
`stack_parity` differential harness — NOT a single `execute_turn → StackDriver` switch. Two facts force this:
(1) the live loop is the frame-stepped `BattleScreen::execute_turn_with_move`/`execute_second_move`
(`mod.rs:1760` / `2027`), **not** the atomic `turn::execute_turn` (which is dead in production, only the
oracle); and (2) production draws RNG via `rand::random()` pre-rolled into `TurnRandoms` *before* ordering,
whereas `StackDriver` draws lazily inside the fold. The migration must (P0) first build a `BattleRng`
shim that replays the pre-roll byte order — including the AI `pick_enemy_move` draws — then route migrated
effect-groups to the stack inside `execute_move`, and flip the production loop to event-replay **last**.
The ~14 native-state-slot tier may stay native Rust **forever** (they need an `EffectStateKind` slot +
handler, and forcing them into RON would break the engine's game-agnostic invariant) — but the ~5
data-reach moves (Transform/Metronome/Mimic/MirrorMove/Conversion) are now migratable too, authored via
the **synchronous script escape hatch** (`16`, phase **P7**) rather than hand-written Rust. With the
hatch, **all 165 moves are migratable**; the script path is isolated at the edge so the
**determinism core stays sacred** (the 497 tests + Gen-1 draw order never depend on script).

---

## 2. The 82-effect classification (A / B / C)

Vocab today (the entire budget): ops `DealMoveDamage, DamageFraction, HealFraction, InflictStatus, Boost,
ScaleRelay, SetRelay, AddRelay, ClampRelay, VetoIf, ApplyTypeChart, PayResource`; selectors `Target/Foe/Host/Source`;
predicates `HasType, StatIs, RelayIntLt`; hook `chance:[n,d]` (= `range(d) < n` = raw `byte < n`, bit-identical
to Gen-1's 51/102/26/77/85/52-over-256 cutoffs, one byte drawn).

> Correction applied from review: side-status moves are **B not A** — every one needs at least `HasVolatile`
> (Substitute block) and most need `MoveTypeIsDefenderType`. Explode and Toxic are **two-primitive B**
> (arena-state-backed), effectively C-adjacent. PoisonSide is reclassified A→B here for the same reason.

| MoveEffect (hex) | #moves | Bucket | Op-list / required primitive |
|---|---|---|---|
| `NoAdditionalEffect 0x00` | 31 | A | `[DealMoveDamage, ApplyTypeChart]` |
| `Effect01 0x01` / `Effect1E 0x1E` | 0/0 | A | alias of 0x00 (unused) |
| `SwiftEffect 0x11` | 1 | A | `[DealMoveDamage, ApplyTypeChart]`; accuracy bypass lives in `move_execution` |
| `PoisonSideEffect1 0x02` | 1 | B | `chance:[51,256]` → `VetoIf(HasType Poison Foe)`, `VetoIf(HasVolatile Substitute Foe)`, `InflictStatus(Poison,Foe)` — needs **HasVolatile** |
| `PoisonSideEffect2 0x21` | 2 | B | as 0x02, `chance:[102,256]` |
| `BurnSideEffect1 0x04` | 3 | B | `chance:[26,256]` + `VetoIf(MoveTypeIsDefenderType)` + Sub-veto + `InflictStatus(Burn,Foe)` — needs **MoveTypeIsDefenderType**, **HasVolatile** |
| `BurnSideEffect2 0x22` | 1 | B | as 0x04, `chance:[77,256]` |
| `FreezeSideEffect1 0x05` | 3 | B | as 0x04 family, `InflictStatus(Freeze,Foe)` |
| `FreezeSideEffect2 0x23` | 0 | B | as 0x05, `chance:[77,256]` (unused) |
| `ParalyzeSideEffect1 0x06` | 4 | B | as 0x04 family, `InflictStatus(Paralysis,Foe)` |
| `ParalyzeSideEffect2 0x24` | 2 | B | as 0x06, `chance:[77,256]` |
| `FlinchSideEffect1 0x1F` | 3 | B | `chance:[26,256]` + Sub-veto + `SetVolatile(Flinched,Foe)` — needs **SetVolatile** + `EffectStateKind::Flinched` |
| `FlinchSideEffect2 0x25` | 4 | B | as 0x1F, `chance:[77,256]` |
| `ConfusionSideEffect 0x4C` | 2 | B | `chance:[26,256]` + `SetVolatile(Confused{turns},Foe)` — needs `EffectStateKind::Confused` + `BeforeMove` resolver |
| `SleepEffect 0x20` | 5 | B | primary; `(rng&7).max(1)` turns, ignores Substitute — needs **StatusWithDuration** + sleep-turn state |
| `PoisonEffect 0x42` | 3 | B | plain poison DSL-able; **Toxic branch** = `EffectStateKind::Toxic{counter}` (uncapped ramp, bug #6) — two-primitive |
| `ParalyzeEffect 0x43` | 3 | B | `VetoIf(MoveTypeIsDefenderType)` + Sub-veto + `InflictStatus(Paralysis,Foe)` |
| `ConfusionEffect 0x31` | 2 | B | `SetVolatile(Confused{turns},Foe)`, `(rng&3)+2` turns |
| `AttackUp1Effect 0x0A` | 2 | A | `[Boost(Attack,+1,Host)]` |
| `DefenseUp1Effect 0x0B` | 3 | A | `[Boost(Defense,+1,Host)]` |
| `SpeedUp1Effect 0x0C` | 0 | A | `[Boost(Speed,+1,Host)]` (unused) |
| `SpecialUp1Effect 0x0D` | 1 | A | `[Boost(Special,+1,Host)]` |
| `AccuracyUp1Effect 0x0E` | 0 | A | `[Boost(Accuracy,+1,Host)]` (unused) |
| `EvasionUp1Effect 0x0F` | 2 | A | `[Boost(Evasion,+1,Host)]` |
| `AttackUp2Effect 0x32` | 1 | A | `[Boost(Attack,+2,Host)]` |
| `DefenseUp2Effect 0x33` | 2 | A | `[Boost(Defense,+2,Host)]` |
| `SpeedUp2Effect 0x34` | 1 | A | `[Boost(Speed,+2,Host)]` |
| `SpecialUp2Effect 0x35` | 1 | A | `[Boost(Special,+2,Host)]` |
| `AccuracyUp2Effect 0x36` / `EvasionUp2Effect 0x37` | 0/0 | A | self-Boost +2 (unused) |
| `AttackDown1Effect 0x12` | 1 | B | `[Boost(Attack,-1,Foe)]` gated by Mist+Substitute = **nested-veto cascade** (needs pokered-side driver firing `TryBoost`/`run_event_checked`) |
| `DefenseDown1Effect 0x13` | 2 | B | as 0x12, Def |
| `SpeedDown1Effect 0x14` | 1 | B | as 0x12, Spe |
| `SpecialDown1Effect 0x15` | 0 | B | as 0x12, Spc (unused) |
| `AccuracyDown1Effect 0x16` | 4 | B | as 0x12, Acc |
| `EvasionDown1Effect 0x17` | 0 | B | as 0x12, Eva (unused) |
| `AttackDown2Effect 0x3A` … `EvasionDown2Effect 0x3F` | 0,1,0,0,0,0 | B | as 0x12 at ±2; only `DefenseDown2 0x3B` (1) is live |
| `AttackDownSideEffect 0x44` | 1 | B | `chance:[85,256]` + `Boost(Attack,-1,Foe)` + same Mist/Sub cascade |
| `DefenseDownSideEffect 0x45` | 1 | B | as 0x44, Def |
| `SpeedDownSideEffect 0x46` | 3 | B | as 0x44, Spe |
| `SpecialDownSideEffect 0x47` | 1 | B | as 0x44, Spc |
| `DrainHpEffect 0x03` | 3 | A | `[DealMoveDamage, ApplyTypeChart, HealFraction(Host, lastDamage, 1/2)]` (min 1) |
| `DreamEaterEffect 0x08` | 1 | B | drain gated `VetoIf(!TargetHasStatus Sleep)` — needs **TargetHasStatus** |
| `RecoilEffect 0x30` | 4 | A | `[DealMoveDamage, ApplyTypeChart, DamageFraction(Host, lastDamage, 1/4)]`; Struggle authored separately at 1/2 |
| `ExplodeEffect 0x07` | 2 | B | self HP→0 + clear Seeded — needs **SetHp** + **ClearVolatile** (two-primitive) |
| `OhkoEffect 0x26` | 3 | B | `VetoIf(!LevelGE)` + `SetHp(Foe,0)` — needs **LevelGE** + **SetHp**; relocate from `move_execution` |
| `SuperFangEffect 0x28` | 1 | B | `DamageCurrentHpFraction(Foe, 1/2)` (min 1) — needs **DamageCurrentHpFraction** |
| `SpecialDamageEffect 0x29` | 5 | B | `SetDamage(expr)` ∈ {level, 40, 20, psywave `rng·1.5·lvl`}, bypass type chart — needs **SetDamage** |
| `JumpKickEffect 0x2D` | 2 | B | on-miss crash 1 HP — needs **on:Miss** hook + crash damage |
| `TwoToFiveAttacksEffect 0x1D` | 7 | B | 2-5 hits, 3/8·3/8·1/8·1/8 — needs **RepeatHits** loop seam + hit-count state |
| `AttackTwiceEffect 0x2C` | 2 | B | `RepeatHits(2)` |
| `TwineedleEffect 0x4D` | 1 | B | `RepeatHits(2)` + poison `chance:[52,256]` on final hit only |
| `ChargeEffect 0x27` | 5 | C | turn-spanning `EffectStateKind::Charge{move}` + `forced_action`; native two-turn resolver |
| `FlyEffect 0x2B` | 1 | C | as Charge + `EffectStateKind::Fly` + `Invulnerability` fast-exit gate (#15) |
| `TrappingEffect 0x2A` | 4 | C | cross-battler lock-out (#16) `EffectStateKind::Trapping{move,turns}` + `forced_action` |
| `ThrashPetalDanceEffect 0x1B` | 2 | C | `EffectStateKind::LockedMove{turns}` + self-confuse on end (#17) |
| `HyperBeamEffect 0x50` | 1 | C | `EffectStateKind::Recharge` + `forced_action→Nothing`, only if target survives (#14) |
| `BideEffect 0x1A` | 1 | C | `EffectStateKind::Bide{turns,accum}` reads `mv.last_damage`; ×2 (#18) — **no legacy oracle** |
| `MistEffect 0x2E` | 1 | C | side flag `EffectStateKind::Mist` set-once; veto resolver for the foe stat-down cascade |
| `FocusEnergyEffect 0x2F` | 1 | C | `EffectStateKind::FocusEnergy` + `ModifyCritRatio` ÷4 fold (Gen-1 bug #1) |
| `LightScreenEffect 0x40` | 1 | C | side flag + `ModifyDamage` halving resolver |
| `ReflectEffect 0x41` | 1 | C | as LightScreen |
| `HazeEffect 0x19` | 1 | C | reset all stages/volatiles/status both sides — needs **ResetAll broadcast** (no selector can express this) |
| `HealEffect 0x38` | 3 | A/C | Recover/Softboiled = `[HealFraction(Host, maxHp, 1/2)]` (A); **Rest** = full-heal + self-sleep(2) + cure (C) |
| `LeechSeedEffect 0x54` | 1 | C | set is DSL-able; end-of-turn drain-to-source = `EffectStateKind::LeechSeed{src}` + `Residual` resolver |
| `SubstituteEffect 0x4F` | 1 | C | `EffectStateKind::Substitute{hp}` + high-priority damage/status redirect interceptor (#28, cross-battler `pair_mut`) |
| `RageEffect 0x51` | 1 | C | `EffectStateKind::Rage` reactive `DamagingHit`-taken → Atk up — **no legacy oracle** |
| `DisableEffect 0x56` | 1 | C | `EffectStateKind::Disable{move,turns}` + action-selection veto + countdown |
| `TransformEffect 0x39` | 1 | C | reaches `P::Species`/move data → `Event::Custom` game-side |
| `MimicEffect 0x52` | 1 | C | move-slot rewrite → `Event::Custom` |
| `MetronomeEffect 0x53` | 1 | C | random move 1-165 skip self → `Event::Custom` |
| `MirrorMoveEffect 0x09` | 1 | C | re-dispatch foe last move → `Event::Custom` |
| `ConversionEffect 0x18` | 1 | C | copy foe types → `Event::Custom` |
| `PayDayEffect 0x10` | 1 | A | `[DealMoveDamage, ApplyTypeChart, PayResource(coinPool, level·2)]` |
| `SplashEffect 0x55` | 1 | A | empty op-list / `Custom` no-op |
| `SwitchAndTeleportEffect 0x1C` | 3 | C | flee/end-battle flag mutating **provider session state** (`escaped`/`is_battle_over`), not `BattleState<P>` |

**Counts:** A = 20 variants (~48 moves), B = 34 (~52 moves), C = 27 (~27 moves), +Heal split = 82 ✓ / 165 ✓.
The C tier of 27 variants splits by *migration mechanism*: **~22 native-state-slot** (`EffectStateKind`
slot + native handler — Bide/Charge/Fly/Trapping/Thrash/HyperBeam, Substitute/LeechSeed/Rage,
Mist/FocusEnergy/Reflect/LightScreen, Haze, Rest, Disable, Teleport/Roar/Whirlwind, Counter) + the
**5 script-hatch** data-reach moves (Transform/Metronome/Mimic/MirrorMove/Conversion → `16`, phase P7).
**Not in the 82, but a real gap:** *Counter* (MoveId 0x44) carries `effect: NoAdditionalEffect` in
`Counter.json`; its ×2-damage-taken logic is hardcoded in `move_execution`, so it is a **native (C)**
reactive effect with **no MoveEffect-driven parity test** — the thinnest ice with Bide/Rage.

---

## 3. Vocabulary-expansion spec (deduplicated, for bucket B)

All additions are **additive and defaulted**; **none touch `dotzuki-engine` core types** except the two explicit
engine *seams* flagged below. New ops/predicates live in `dotzuki-rules` (game-agnostic infra: `model.rs` enum +
`interp.rs` arm + `registry.rs::validate_op`, sometimes a `RuleBindings` method). New state lives game-side as
`P::EffectStateKind` variants (opaque to the engine — zero engine change).

### New DSL predicates (`dotzuki-rules`)
| Predicate | What it does | Seam | Effort |
|---|---|---|---|
| `MoveTypeIsDefenderType` | Gen-1 burn/freeze/para self-type immunity quirk (`status_effects.rs:85/110/135`) | dotzuki-rules | S |
| `HasVolatile(kind, sel)` | volatile presence (Substitute block, Leech Seed already-seeded) | dotzuki-rules | S |
| `TargetHasStatus(status)` | Dream Eater sleep gate | dotzuki-rules | S |
| `LevelGE` | OHKO atk-lvl ≥ def-lvl gate | dotzuki-rules | S |

### New DSL ops (`dotzuki-rules`)
| Op | What it does | Seam | Effort |
|---|---|---|---|
| `SetVolatile(kind, sel)` / `ClearVolatile(kind, sel)` | Flinch/Confusion set; Explode clear-Seeded | dotzuki-rules (+state) | M |
| `SetHp(sel, value)` | Explode (0), OHKO (0) | dotzuki-rules | S |
| `DamageCurrentHpFraction(sel, n, d)` | Super Fang `curHP/2` (today `DamageFraction` scales the relay, not target curHP) | dotzuki-rules | S |
| `SetDamage(expr)` | Special/fixed damage {level, const, `rng·1.5·lvl`}, bypass type chart | dotzuki-rules | M |
| `StatusWithDuration(status, dur_expr)` | Sleep `(rng&7).max(1)` turns | dotzuki-rules (+state) | M |
| `RepeatHits(count_expr)` | Multi-hit loop (2-5 dist, exactly-2, Twineedle final-hit hook) | **ENGINE SEAM** | L |

### New game-side `EffectStateKind` variants (zero engine change)
| Variant | Purpose | Effort |
|---|---|---|
| `Flinched` | consumed by `BeforeMove` | S |
| `Confused{turns_left}` | + `BeforeMove` self-hit resolver (#13) | M |
| `Toxic{counter}` | uncapped ramp (#6) — prototyped in `mod.rs:329` | S |
| `SleepTurns` | if not modeled on the `Status` itself | S |

### New engine seam (the only true core touch)
| Seam | Purpose | Effort |
|---|---|---|
| `on:Miss` hook event | JumpKick crash fires on the miss branch (today only on-hit `DamagingHit` fires) | M |
| `RepeatHits` loop construct | StackDriver-level multi-hit orchestration + per-mon hit-count scratch | L |

### Shared native orchestration unblocking bucket B/C foe-down
The **nested-veto cascade** (foe stat-down through Mist/Substitute) is *not data-expressible*: `TryBoost` is a
registration seam the `StackDriver` never fires. A **pokered-side driver** must fire `TryBoost` and re-enter
`run_event`/`run_event_checked` (the Intimidate/Clear-Body shape). One-time **effort L**; it unblocks all 13
foe-down arms + Mist + Substitute's stat-down absorption at once.

---

## 4. Production-swap plan

**The seam.** Three live call sites execute moves, all of which must eventually route through the stack:
`BattlePhase::MoveSelect → execute_turn_with_move(idx)` (`mod.rs:1760`); the run-then-enemy-attacks path
(`mod.rs:~1740`); the item-then-enemy-attacks path (`mod.rs:~2006`). `turn::execute_turn` is the **dead oracle**
— do **not** name it as the swap target; it runs both movers atomically and cannot drive the frame-stepped UI.

**Why not a single switch.** (1) The 497 tests call the *oracle* `turn::execute_turn`, not the production loop,
so gating the *production* swap on them proves the oracle still works, not that production matches it — the
honest gate is the side-by-side differential (`stack_parity/mod.rs:1996/2087`) extended to the two-mover + AI
case. (2) `StackDriver` is atomic and returns `TurnOutcome{events, battle_over}`; production splits across
animation frames via `PendingSecondMove` (`mod.rs:329/1395/1871`). The flip is therefore a **UI rewrite**:
`execute_turn_with_move` runs the driver once and enqueues `TurnOutcome.events`; `PendingSecondMove` becomes
"next event in the outcome queue"; `execute_second_move` is deleted.

**RNG draw-order parity (load-bearing, the hardest invariant).** Production pre-rolls the entire
`TurnRandoms { order_random, first_mover, second_mover }` (`turn.rs:8-11`) with `rand::random()` (14 sites in
`mod.rs`) **before** ordering, where each `MoveRandoms` is the canonical order
`confusion → paralysis → crit → accuracy → damage` then `EffectRandoms { side_effect_roll, duration_roll,
multi_hit_roll }`. `StackDriver` draws lazily inside the fold. Reuse the **proven shim**
(`stack_parity` `MoveBytes`/`Scenario`/`run_scenario`): a byte vector laid into `TurnRandoms` (legacy) and fed to
a `ScriptedRng`/`BattleRng` (stack) in the **same fire order**. Two non-negotiables, both pinned by standing
tests: the **order byte is drawn first, exactly once, even on a speed tie** (`turn_order.rs:40-41`, bug #22);
and **crit is drawn before accuracy** (`assert_crit_drawn_before_accuracy`). Inert handlers must still draw
their byte at the legacy ordinal (the slices already do "always read the field") so `consumed()` stays
invariant. `chance:[n,256]` is bit-identical to `byte < n` (verified: `range(256) = next_u8()%256`), so the
side-effect threshold math is the *least* risky part. **The unproven hazard is the AI-draw interleave**:
`pick_enemy_move` draws `rand::random()` (`mod.rs:794` AI pick, `mod.rs:803` random fallback) *between* the
pre-roll and execution — the shim must replicate this ordinal, and the slices never proved it.

**Deliberate Gen-1 bugs.** Preserve all 30 from `06 §6`. The ~19 native-C effects map almost 1:1 onto the
**structural** bugs (#1 FocusEnergy ÷4 crit, #6 Toxic uncapped, #14 HyperBeam no-recharge-on-faint, #15 Fly
invuln, #16 trap cross-battler, #17 Thrash self-confuse, #18 Bide ×2, #28 Substitute absorb). 1/256 miss (#2),
crit-before-accuracy (#3), immunity-as-miss short-circuit (#4), stat overflow `>>2` (#5), `×roll/255` (#29),
stage clamp −6..+6 (#30) are folds the stack already reproduces. Each migrated effect must keep its specific bug.

**Read-side (menu/AI/animation) adaptation.**
- **AI** (`pick_enemy_move`, `mod.rs:777`) stays a pre-step producing the enemy `BattleAction<P>` fed to
  `actions[1]`; its draws remain in the shared RNG stream so their ordinal still matters.
- **Text** (`format_move_outcome`, reads `MoveOutcome { is_critical, type_effectiveness }`) must re-derive its
  strings ("A critical hit!", "It's super effective!") from `TurnEvent` variants instead of `MoveOutcome`.
- **Renderer** reads **no** `MoveOutcome`/`TurnResult` (grep of `pokered-renderer`/`pokered-app` = zero refs);
  it reads only the post-turn `BattleState` snapshot via `sync_display_from_state` (`mod.rs:744`). The render
  swap surface is just keeping that fed from the engine `BattleState<P>` after each replayed event.
- **Run/capture** (`try_run_from_battle`, ball paths) stay provider-side but share the RNG stream.

**State mapping.** Engine `BattlerState<P>` holds only `hp/max_hp/stats/stat_stages/status/moves/resources`.
pokered's per-turn scratch (`move_missed`, `critical_or_ohko`, `damage`, `whose_turn`) → engine `MoveContext`
(`mv.last_damage` is the canonical home for Counter/Bide reads). The session scalars
(`num_run_attempts`, `escaped`, `party_fought_flags`, `total_payday_money`, `is_battle_over`, `battle_type`)
are Pokémon-specific → **provider session state**. Every `battle_status1/2/3` volatile + scalar counters
(`substitute_hp`, `toxic_counter`, `disabled_*`, `num_attacks_left`, `bide_accumulated_damage`, `last_move_used`)
→ typed `EffectState<P>` arena entries; `reset_volatile_status` → arena eviction keyed by `EffectState.host`
on the switch event. PP → the generic `ResourcePool` cost-gate (Gen-1 has no MP, so the gate stays inert
unless PP is modeled there).

---

## 5. Phased roadmap (each phase ships green)

Every phase keeps all **497 battle tests** green and extends the `stack_parity` differential harness; the legacy
`apply_move_effect` dispatcher remains the default and the oracle until P6.

**P0 — RNG shim (prerequisite; missing from the original plan).**
Build the production `BattleRng` that replays `rand::random()` in `TurnRandoms` pre-roll order **including the AI
`pick_enemy_move` draws**. *Delivers:* a stream the stack and legacy share. *Proves:* full two-mover + AI turn,
`consumed()` parity, on ≥20 scenarios spanning hit/miss/faint-short-circuit/speed-tie. **Nothing else is safe
until this exists.** Effort **L**.

**P1 — Pure damage + self-Boost (~43 moves, A).**
Stand up a pokered `RulesProvider`/`EffectProvider` (`type EffectStateKind = PokeVolatile`; keep
`calculate_damage` as the single damage authority precomputed into `ctx.mv.damage`); author the A moves in
`rules.ron` behind a flag; route only those effects to the stack inside `execute_move`. *Proves:* differential
vs legacy on the damage/crit/accuracy pipeline (40-test slice), type chart (13), stat clamp (16). Effort **M**.

**P2 — Side-status (25) + drain/recoil (10).**
Add predicates `HasVolatile`, `MoveTypeIsDefenderType`, `TargetHasStatus`; wire the `last_damage` relay read.
*Proves:* status-gate slice (24) + Substitute-block + type-immunity quirk (#23), with `side_effect_roll` drawn
at the legacy ordinal even when inert. Effort **M**.

**P3 — Special/fixed/OHKO (11) + foe stat-down nested-veto (13).**
Add ops `SetHp`, `SetDamage`, `DamageCurrentHpFraction`, predicate `LevelGE`; relocate special damage out of
`move_execution` into stack damage-relay writes; build the **pokered-side driver** firing `TryBoost`/
`run_event_checked` (the one shared native orchestration). *Proves:* Mist+Substitute cascade vetoes, OHKO level
gate (#19), immunity-as-miss (#4). Effort **L**.

**P4 — Multi-hit (10).**
Add the `RepeatHits` loop seam + per-mon hit-count state. *Proves:* 2-5 distribution (#24/#25), exactly-2,
Twineedle final-hit poison. Effort **M-L**.

**P5 — The GAP: multi-turn / field / volatile (~14 native state-slot, C).**
Native `&'static Effect` handlers + `EffectStateKind` arena + `forced_action`; the `on:Miss` hook (JumpKick) and
`ResetAll` broadcast (Haze). These **need a Rust state-slot, NOT script** — turn-spanning state, cross-effect
interceptors, and field flags are on the cross-turn / parity-critical path. *Proves:* each Gen-1 bug
(#1, #6, #14-18, #28) AND cross-turn carry under frame-stepped replay; flag the reactive Bide/Counter/Rage as
synthetic-oracle-only. Effort **L**.

**P6 — Flip the production loop to event-replay.**
Delete `execute_second_move`, turn `PendingSecondMove` into an outcome-event queue; route the live move call
sites through the stack. *Proves:* the ~226 orthogonal tests (menu 57, AI 62, capture 15, wild 14, escape 17,
experience 33, settlement 28) stay green. Effort **L**. (The 5 data-reach moves are deferred to P7 — they can
ship as interim native `Event::Custom` handlers here if needed, then be re-expressed as script in P7.)

**P7 — The script escape hatch: the 5 data-reach moves (`16`).**
Wire the **synchronous Boa facade** behind the index-based `HandlerImpl::Script` arm + a defaulted
`script_runtime()` provider method (both additive + defaulted to "no script runtime"). Build the sterile realm
(strip `Math.random`/`Date`/timers/`Promise`), the closed synchronous host with all randomness routed through
`ctx.rng`, and the instruction cap (overrun ⇒ `Unchanged`). Re-express Transform/Metronome/Mimic/MirrorMove/
Conversion as scripts. **Determinism core stays sacred:** the facade is off the parity path; the 497 tests +
88 slices are byte-identical because `script_runtime()` defaults to `None` everywhere except the pokered facade.
*Proves (POC = Metronome first, `16 §8`):* deterministic `ScriptedRng` replay + draw-order parity vs native;
the 497 tests / 88 slices unchanged; sterility + instruction-cap enforced. With P7 done, **all 165 moves are
migratable**. Effort **M-L**. (Honest alternative, `16 §7.1`: these 5 may instead **stay native** `Event::Custom`
forever — lower risk, but the "all 165 migratable without Rust" headline then stays false for exactly 5 moves.)

---

## 6. Risks + non-goals

**Top risks (descending).**
1. **AI-draw interleave between pre-roll and execution is unproven** (`mod.rs:794/803`) — can silently desync
   every turn; gated by P0. Mitigation: extend the differential harness to the two-mover+AI case before any
   stack routing.
2. **Frame-stepped UI ⇄ atomic StackDriver mismatch** — `PendingSecondMove` → event-replay is a UI rewrite, not
   a switch; gated to P6 after every effect group is stack-backed.
3. **Reactive accumulators (Bide/Counter/Rage) have no legacy oracle** — Counter isn't even a `MoveEffect`
   (`effect: NoAdditionalEffect`), so slice 6 is synthetic-only proof; the thinnest ice.
4. **Two-primitive effects (Explode, Toxic) are arena-state-backed**, not clean ops — effort underestimated;
   schedule them with P3/P5 not P2.
5. **Headline count inflation** — sizing P1 off the old "~73 A" figure overshoots by ~25 (the side-statuses are
   B). Budget P1 against ~43-48 moves.

**Non-goals (explicit).**
- **Doubles / grid / multi-target stay out** — engine remains single-battle for pokered; no `[Action;N>2]`.
- **The ~14 native-state-slot tier may stay native Rust forever** — turn-spanning state / cross-effect
  interceptors / field flags need an `EffectStateKind` slot + handler; forcing them into RON would break the
  engine's game-agnostic invariant. They are **not** script candidates (cross-turn / parity-critical path).
- **The 5 data-reach moves are migratable via script, not RON** — Transform/Metronome/Mimic/MirrorMove/
  Conversion go through the synchronous script escape hatch (`16`, P7), **not** the declarative DSL: putting
  them in RON would force the DSL to reach `P::Species`/move-table data and break the engine's game-agnostic
  invariant. (Honest fallback, `16 §7.1`: keep these 5 native `Event::Custom` — lower risk, costs the
  "all 165 migratable" headline.)
- **No "all 165 in RON"** — the target is ~48 fully-RON, ~98 RON-declarative-shell + reusable primitive,
  ~14 native state-slot, ~5 script-hatch. ("Migratable" ≠ "RON": the 5 data-reach moves are migratable via
  *script*, and ~14 via native Rust + state-slot; **all 165 are migratable**.)
- **Determinism core is sacred** — draw-order parity via the shim is mandatory; changing the expected bytes is
  off the table because determinism is the load-bearing Gen-1 contract. The script hatch (`16`) does **not**
  relax this: it is additive + defaulted to "no script runtime," strips entropy from the realm, routes all
  randomness through `ctx.rng`, and is isolated at the edge — so the 497 tests + 88 slices stay byte-identical.

**See also:** [`16-script-escape-hatch-design.md`](./16-script-escape-hatch-design.md) — the synchronous
script escape hatch that makes the 5 data-reach moves migratable (the `HandlerImpl::Script` model, the sterile
sync Boa facade, the structural-vs-by-review determinism contract, and the Metronome POC); phase **P7** above.
