# 13 — Audit: common JRPG battle concepts vs. the effect-stack engine

**Status:** audit / review (docs only — no engine code changes proposed here, only classified).
**Scope:** a genre-wide, honest review of battle concepts drawn from across the JRPG canon
(Final Fantasy I–XV, Dragon Quest, Persona/SMT, Octopath, Bravely Default, FFT/Triangle
Strategy, FFX/X-2, SaGa) measured against what `jrpg-engine`'s `battle::stack` engine can
actually express today.

This synthesizes three audit slices:

- **A** — resources / targeting / turn-economy
- **B** — party structure / grid / formation
- **C** — mechanics / affinity / buffs / meta gauges

All engine claims below are grounded in re-read source (cited inline `file:line`). Design-doc
references are `doc 09/11/12` = `09-battle-engine-generalization-design.md`,
`11-no-code-authoring-design.md`, `12-typechart-ron-design.md`.

---

## 1. Executive summary

### What the engine IS shaped for

`jrpg-engine::battle::stack` is a **Showdown-style effect-stack** battle engine: native-Rust
handlers fold a typed `RelayVar` through a closed taxonomy of `Event` keys. It is **not** a
scripting VM and **not** a data interpreter — effects are `fn`-pointer handlers hosted by
defaulted provider resolvers, with per-effect mutable state in an `EffectState` arena keyed by
`EffectId` + host.

Its shape is precisely **Pokémon-style 1v1-plus-switch**:

- **Two sides only.** `BattleState` is exactly `player_battlers` / `opponent_battlers`, each a
  `Vec<BattlerState>`, with the *active* battler = `.first()` of each
  (`battle/mod.rs:648-698`).
- **One active slot per side + switch.** Not a party-of-N all acting each round; not a grid.
- **A single target.** Targeting is one `BattlerRef { side, slot }` (`mod.rs:243-261`); the
  handler signature passes exactly one `target` and one `source` (`event.rs:276-282`). No
  all-foes / all-allies / row / spread selector exists.
- **One action per side per turn.** `BattleAction` = Fight / Switch / UseItem / Run / Nothing
  (`mod.rs:290-310`); the driver builds `[player_action, opponent_action]` and stable-sorts that
  pair *once* via `turn_order_key`'s `OrderKey(priority, speed, tiebreak)` (`mod.rs:281-282`).
  No ATB / CTB / initiative-list / multi-act / press-turn.
- **Integer-only relay.** `RelayVar = { Unit, Int(i64), Damage(u16), Accuracy(u8), Bool(bool) }`;
  rationals are done with `scale(num, den)` (`event.rs:154-225`). No float, no resource lane.
- **Resources = PP only** (and even PP currently lives game-side, not in `BattlerState`, which
  holds only hp/max_hp/stats/stat_stages/status/moves — `mod.rs:565-580`). No MP/SP/TP/mana
  pool, no per-battler/per-side gauge.
- **Stat changes are STAGES.** `stat_stages: EnumMap<P::Stat, i8>` folded via
  `TryBoost`/`AfterBoost`/`ModifyStat` (`mod.rs:575`, `event.rs:95-103`). **There is no
  turn-count duration field** anywhere on the battler — stages are permanent until changed.
- Everything else (abilities, items, weather, field, status, volatiles) is an **Effect** hosted
  via defaulted resolvers (`effect_for_ability/_item/_move/_status/_volatile`, `side_effects`,
  `field_effects`), with `EffectHost` = `Battler | Side | Field`.
- A **no-code RON authoring** path (doc 11) lets data declare effects from a *closed* primitive
  vocabulary (`DealMoveDamage`, `DamageFraction`/`HealFraction`, `InflictStatus`, `Boost`,
  `ScaleRelay`, `SetRelay`/`AddRelay`/`ClampRelay`, `VetoIf`) plus `Target/Foe/Host/Source`
  selectors; the `Effectiveness` event (doc 12) does the type-chart rational fold.

### The 3–4 biggest STRUCTURAL gaps

These are *not* effects and cannot be folded onto the current `BattleState`. Each is a different
battle MODEL:

1. **Party-of-N all act each round** (DQ, FF I–X non-row, Octopath, Bravely). The *state* Vec
   already holds N per side, but the driver builds exactly two actors and takes `[Action; 2]`
   (`driver.rs:236-251`); speed-ordering a fixed pair ≠ ordering an initiative list of M+N live
   actors. This is the **smallest** structural step.
2. **Multi-target** (all-foes / all-allies / spread / row / area). The handler dispatch is a
   single `(target, source)` `BattlerRef` pair (`event.rs:276-282`); with one active slot per
   side, "all foes" *is* the one foe. Real spread requires >1 active slot — a different active-set
   shape — and *then* a fan-out + falloff event.
3. **Alternative turn economies** (ATB, CTB/FFX, press-turn/SMT, one-more/Persona, multi-act,
   Bravely BP, FFX delay). All require a persistent timeline / accumulator / re-entrant action
   loop the one-shot 2-side comparator does not have (`mod.rs:281-282`, `driver.rs:248`). Each is
   a **second battle MODEL**, a scheduler driver — not a fold.
4. **Grid / tactics** (FFT, Triangle Strategy). There is no spatial coordinate anywhere
   (`BattleState` has weather/terrain/turn_count, no map, no positions; `BattlerRef` is
   `(side, slot)`, not `(x, y)`). This is a *fundamentally different engine*, not the effect-stack.

The honest bottom line: **single-target / self / speed-order / type affinity / stages / DOT /
status / drain / revive are native or pure content.** Resources are mostly small additive seams.
But **every multi-target shape and every turn-economy beyond one-action-per-side is a different
battle model**, and grid tactics is a different product. Doc 09 already concedes the doubles
redirect seam is inert and explicitly **"not a goal"** (doc 09:534).

---

## 2. Master table

**Classification key:**
`EXPRESSIBLE-NOW` (effects/RON today, zero engine change) ·
`NEW-EVENT` (one additive defaulted `Event`) ·
`STATE-SEAM` (a new arena/side/party gauge or field, additive) ·
`STRUCTURAL` (a different `BattleState` shape — a second battle MODEL, not the effect-stack).

### Slice A — Resources · Targeting · Turn-economy

| Concept | Canonical game | Classification | What we would add | Value | Effort |
|---|---|---|---|---|---|
| Item / berry consumption | Pokémon | EXPRESSIBLE-NOW | nothing — `End` + `effect_for_item`, arena flag | high | free |
| HP-cost skills | Belly Drum; FF Blood Magic | EXPRESSIBLE-NOW | nothing — `DamageFraction(of:MaxHp, Host)` (HP is the universal gauge) | high | free |
| Per-move PP (engine-hosted) | Pokémon | STATE-SEAM | per-move use counter beside `moves` (`mod.rs:579`) | med | low |
| MP / SP / TP / mana pool | FF, DQ, most classic | STATE-SEAM | battler gauge `EnumMap<P::Resource, u16>` + pre-`BeforeMove` cost check | high | low–med |
| Cooldown / per-skill lockout | FFXIV, Disable | STATE-SEAM | typed `EffectStateKind` counter ticked on `ResidualOrder` (Rust, not data — doc 11:304) | med | low–med |
| Charge / wind-up (2-turn lock) | Solar Beam, Hyper Beam | EXPRESSIBLE-NOW | nothing — `BeforeMove`→Forced-action continuation, arena state | med | free |
| Single-enemy target | every JRPG | EXPRESSIBLE-NOW | nothing — native (`BattlerRef::OPPONENT`) | — | — |
| Self target | every JRPG | EXPRESSIBLE-NOW | nothing — `Host`/`Source` selector | — | — |
| All-foes / all-allies / spread | Explosion, Earthquake; FF group | STRUCTURAL (slots) + NEW-EVENT (fan-out) | >1 active slot per side, then a `MoveTarget` descriptor + driver fan-out | high | high |
| Spread falloff (0.75×) | Pokémon doubles | NEW-EVENT (rides on multi-active) | defaulted `ModifySpreadDamage` via `scale(3,4)` — useless before multi-active | low | low* |
| Random target | Thrash; FF random-enemy | NEW-EVENT | defaulted `select_target` hook (degenerate with one slot) | low | low* |
| Ally-or-self heal target | FF/DQ | EXPRESSIBLE-NOW *shape* / STRUCTURAL to matter | needs a second active ally to point at (= multi-active) | med | high |
| Row / front-back targeting | FF/SaGa | STRUCTURAL | a position axis on `BattlerRef` (new topology) | niche | high |
| Redirect (Lightning Rod / Provoke) | Pokémon doubles; FF cover | NEW-EVENT, gated on multi-active | defaulted `redirect_target` off `TryHit` — inert in 1v1, doc 09 "not a goal" | low | low* |
| Speed initiative (who-first) | every JRPG | EXPRESSIBLE-NOW | nothing — `OrderKey` speed term | — | — |
| Party-of-4 all input then resolve | DQ, FF1 | STRUCTURAL | generalized driver: `Vec<(BattlerRef, Action)>` over all live slots | high | med–high |
| Multi-act / extra turn / haste-2× | FF Haste | STRUCTURAL | reshape submission to Vec-of-actions per actor | med | med–high |
| ATB (real-time gauge) | FF4–9 | STRUCTURAL | a clock-driven scheduler + per-actor time gauge | high | very high |
| CTB / initiative timeline | FFX | STRUCTURAL | a persistent reorderable turn queue | high | very high |
| Press-turn (icons) | SMT | STRUCTURAL | side action-economy gauge + re-entrant action loop | high | very high |
| One-more (knockdown → free act) | Persona | STRUCTURAL | extra-action insertion the 1-action driver lacks | high | very high |
| Delay / interrupt / act-later | FFX, ATB | STRUCTURAL | mutate a persistent timeline mid-resolution | med | very high |

\* low effort but **near-zero value until multi-active slots exist.**

### Slice B — Party · Grid · Formation · Summons

| Concept | Canonical game | Classification | What we would add | Value | Effort |
|---|---|---|---|---|---|
| Row damage mod (back row ½) | FF I–VI/X | EXPRESSIBLE-NOW | `ScaleRelay` on `ModifyDamage` + a `row` arena flag | high | trivial |
| Summon/persona as callable effect | FF espers; Persona cast | EXPRESSIBLE-NOW | an Effect/move running `DealMoveDamage`/`Boost`/`InflictStatus` | high | low |
| Persona/stand as swap-in package | Persona; JoJo stands | EXPRESSIBLE-NOW (swap) → STATE-SEAM (own gauge) | `BattleAction::Switch` to a hidden slot; gauge if it needs own HP/MP | med–high | low–med |
| Cover / guard / intercept (redirect hit) | FF tank rows | STATE-SEAM (or +NEW-EVENT) | a driver-read redirect slot, or a `RelayVar::Redirect(BattlerRef)` variant — `TryHit` hook exists, relay can't carry a ref today | med | med |
| Party-of-N all act | FF/DQ/Octopath | STRUCTURAL (smallest) | generalized driver over all live slots; state Vec already there | high | med–high |
| Summon/esper as separate combatant | FF that takes a turn | STRUCTURAL (= party-of-N) | the multi-active driver above | med | med–high |
| Grid / tactics (tiles/move/range/facing/ZoC) | FFT, Triangle Strategy | STRUCTURAL (biggest) | an entire `GridBattleState { tiles, positions, facing, height }` + own action/resolver | high (diff product) | very high |
| Formation as real geometry | DQ enemy groups, positional AoE | STRUCTURAL | degrades into grid | niche | very high |

### Slice C — Mechanics · Affinity · Buffs · Meta gauges

| Concept | Canonical game | Classification | What we would add | Value | Effort |
|---|---|---|---|---|---|
| Absorb / drain element (heal vs. damage) | Volt Absorb; FF fire-absorb | EXPRESSIBLE-NOW | `VetoIf` hit + `HealFraction` on `Effectiveness`/`Damage` | high | free |
| Nullify / immunity (0×) | Levitate, Wonder Guard | EXPRESSIBLE-NOW | `Effectiveness` with `[0,1]` (the designed immunity path, doc 12:35) | high | free |
| Pierce (ignore defense/resist) | Mold Breaker | EXPRESSIBLE-NOW | `SetRelay`/raise on `ModifyStat`/`ModifyDamage` | med | free |
| Drain (damage → heal a fraction) | Giga Drain | EXPRESSIBLE-NOW | `HealFraction(Host)` on `DamagingHit` | high | free |
| Instant-death + resist | FF Doom; OHKO moves | EXPRESSIBLE-NOW | `SetRelay` damage ≥ HP; `VetoIf` immunity (Endure shape inverted) | med | free |
| Revive (restore fainted) | Phoenix Down; Revive | EXPRESSIBLE-NOW | native handler on `Faint`/`AfterFaint` + `heal()` | med | free |
| Regen / DOT (per-turn) | Regen, Poison | EXPRESSIBLE-NOW | `HealFraction`/`DamageFraction` on `Residual`/`SideResidual` | high | free |
| Turn-count screens (Reflect/Light Screen) | Pokémon | EXPRESSIBLE-NOW | `side_effects` + `SideResidual` countdown | high | free |
| Reflect/repel as redirect-veto | Magic Bounce | EXPRESSIBLE-NOW | native handler on `TryHit` (single foe — fine) | med | free |
| Taunt / charm / confuse / sleep | DQ confusion; FF sleep | EXPRESSIBLE-NOW | `BeforeMove` veto + `InflictStatus`/volatile | high | free |
| Dispel / cleanse status & volatiles | Esuna | EXPRESSIBLE-NOW | `End` removes volatile; status write | med | free |
| Stat buff with TURN DURATION + stacking | FF Haste/Slow timers | STATE-SEAM | duration variant in `EffectStateKind` + Residual tick (stacking is native — stages clamp ±6) | high | low |
| Dispel stat *stages* from data (Haze) | Haze | STATE-SEAM | a `ClearBoosts` RON primitive (native = now; no data primitive exists) | med | low |
| HP-pool / shield absorb (Substitute) | Substitute; FF shell | STATE-SEAM | shield HP counter in `EffectStateKind` + `Damage`-fold primitive (doc 11:300 not data-reachable) | med | low–med |
| Steal an item | Thief | STATE-SEAM | held-item field on `BattlerState` + transfer on `DamagingHit` | med | low |
| Combo / chain counter (meter only) | Octopath; FFX-2 | STATE-SEAM | counter in `EffectStateKind`; `ScaleRelay` payoff once counter exists | med | low |
| Simple charge meter (Limit/Overdrive/Tension) | FF7/FFX; DQ8 | STATE-SEAM | per-battler gauge in `EffectStateKind`, gate via `BeforeMove` | med | low–med |
| Multi-hit / built-in combo (one action, N strikes) | Fury Attack | EXPRESSIBLE-NOW (native) / STATE-SEAM (data) | native on `ModifyMove`; a parameterized multi-hit primitive for RON (doc 11:311) | med | low |
| Counter / riposte / reaction | Counter | STATE-SEAM (Rust) | native handler reading `mv.last_damage`, deal back to `source` (doc 11:299 not data-reachable) | med | med |
| Reflect-and-replay (re-fire move at attacker) | Magic Bounce replay | STATE-SEAM (Rust) | a `Replay`/`Redirect` primitive + driver orchestration | med | med |
| Flee / escape odds | DQ/Pokémon run | NEW-EVENT (or native) | a defaulted `TryRun` action event; RNG via `BattleRng` | low–med | low |
| Capture (catch-and-end) | Poké Ball | EXPRESSIBLE-NOW | native catch roll + end veto; party add is out-of-battle | med | low |
| Recruit (enemy acts for you mid-fight) | DQM, SMT negotiation | STRUCTURAL | side-membership churn → party-of-N driver | med | high |
| Weak-point break / knock-down (flag) | Persona, Octopath Break | STATE-SEAM (flag) / STRUCTURAL (bonus-turn payoff) | flag = arena counter; the "lose turn / earn act" payoff is turn-economy | med | high |
| Bravely BP multi-act / Default-to-bank | Bravely Default | STRUCTURAL | multi-act-per-turn economy | high (for that game) | very high |
| Persona All-Out-Attack / Showtime | Persona | STRUCTURAL | all-allies-act / all-foes targeting | high (for that game) | very high |

---

## 3. Three-tier roadmap

### Tier 1 — cheap wins (effects / RON / one defaulted event)

Everything here ships **with zero or near-zero engine change**, riding existing events and the
current primitive set. The 1v1 single-target shape is sufficient.

- **Pure content, ship today (EXPRESSIBLE-NOW):** drain/absorb, element-immunity (0×), pierce,
  OHKO + resist, revive, DOT/regen, turn-count screens, taunt/sleep/confuse, dispel
  status/volatiles, reflect-as-redirect-veto, item/berry consumption, HP-cost skills, charge/
  wind-up locks, callable summons/personae, **row damage modifier** (a `ScaleRelay` + a `row`
  arena flag).
- **Small additive STATE-SEAMs (best ROI tier):** **MP/SP/mana pool** (a battler gauge +
  pre-move cost check — unlocks the *entire* classic-JRPG resource genre with no model change);
  engine-hosted PP; timed buffs (`EffectStateKind` duration + Residual tick); cooldowns; held-item
  field for **steal**; combo/chain counters; **simple charge meters** (Limit/Overdrive/Tension);
  a `ClearBoosts` primitive (Haze from data).
- **Rust-only seams (named not-data-reachable in doc 11:299-313):** Counter/riposte (read
  `mv.last_damage`, hit `source`); multi-hit from data; reflect-and-replay.
- **One defaulted NEW-EVENT:** `TryRun` (flee as a moddable interaction).

### Tier 2 — medium (a different turn economy / multi-active, additive but a new driver)

These reuse the effect-stack fold verbatim but need a **second driver and/or a wider active
set**. They are additive (the state Vec is already there) but are genuinely a new battle *model*
sitting beside the 1v1 driver — not a handler.

- **Party-of-N all act** (the smallest structural step): generalize the driver from `[Action; 2]`
  to `Vec<(BattlerRef, Action)>` over all live slots; extend `turn_order_key` across that set.
  Bench it as a second `TurnDriver` impl; effects/RON untouched.
- **Multi-active slots (>1 per side)** — the single prerequisite that converts all-foes/
  all-allies/spread/falloff/ally-or-self/redirect from "degenerate" to "real," plus a `MoveTarget`
  descriptor and a fan-out loop.
- **Taunt / redirect / cover targeting** — meaningful only once there are multiple foes to
  redirect *between* (a driver-read redirect slot or a `RelayVar::Redirect` variant).
- **Summons / personae / stands as separate combatants** that take a slot and act (= rides on
  party-of-N).
- **ATB / CTB** — a clock/timeline scheduler driver with per-actor time gauges. (Higher end of
  Tier 2 / borders Tier 3 effort, but still reuses the fold for each resolved hit.)

### Tier 3 — a different engine shape (a SECOND battle MODEL)

**Stated plainly: Tier 3 is not the effect-stack.** It is a second battle MODEL with a different
`BattleState` shape. The effect-stack (effects + events) would still **ride on top of it** — once
the model resolves a *single concrete hit* (range/positioning has picked one `target`), it fires
`ModifyDamage` / `Effectiveness` / `DamagingHit` exactly as today. But the scheduling, the
positions, and the action economy live *above* the fold, in the new model.

- **Grid / tactics** (FFT, Triangle Strategy): a `GridBattleState { tiles, unit_positions(x, y,
  facing, height), … }` with a Move/Face/Act action set and its own resolver. No spatial
  coordinate exists today (`mod.rs:648-661`, `event.rs:276-282`).
- **True positional / formation as geometry** (DQ enemy groups, positional AoE): degrades into the
  grid model.
- **Press-turn (SMT) / one-more (Persona) / Bravely BP / multi-act / FFX delay**: re-entrant /
  banked / interrupting action economies that the one-action-per-side driver cannot express; each
  needs a scheduler model. (Note: these are turn-economy STRUCTURAL changes, not spatial ones —
  Tier 3 by *kind of change*, even if cheaper than a full grid.)

---

## 4. Recommended roadmap and the single highest-value next addition

**Recommended order:**

1. **Drain Tier 1 EXPRESSIBLE-NOW first** — it is free content that already demonstrates the
   engine covers a large slice of the genre (affinity, DOT, status, screens, summons, rows).
2. **Then the additive STATE-SEAMs**, leading with the resource gauge.
3. **Defer Tier 2** until a target game actually needs party-of-N or multi-active; build it as a
   *second driver*, not a contortion of the 1v1 comparator.
4. **Treat Tier 3 as a separate product decision** — a sibling battle model that reuses the
   effect-stack for hit resolution. Do **not** attempt grid tactics or alternative turn economies
   by bending `BattleState`.

**The single highest-value next addition: a per-battler resource gauge (MP/SP/mana pool).**

It is a STATE-SEAM, not a structural change: one additive field on `BattlerState`
(an `EnumMap<P::Resource, u16>` mirroring `stats`) plus a cost/pay check before `BeforeMove`. The
two-side / one-active-slot / single-target shape is entirely untouched, every existing handler and
RON effect keeps working, and it unlocks the **entire classic-JRPG resource genre** (FF, DQ, and
most turn-based JRPGs) that the engine cannot represent today (there is genuinely no pool field —
`mod.rs:565-580` — and `RelayVar` has no resource lane — `event.rs:154-165`). That is the best
return on a small, low-risk, additive change for any game beyond Pokémon. (Row damage modifiers and
callable summons are the best *zero-cost* wins, but they are already expressible — the gauge is the
best thing the engine *cannot yet do* and could, cheaply.)

---

### Honesty notes (do not let the table read more optimistically than the engine)

- "All-foes" today **is** the single foe; spread/falloff/redirect/random-target hooks are cheap to
  add but **inert and near-valueless until multi-active slots exist** (`mod.rs:680-696`,
  `event.rs:276-282`).
- `EffectStateKind` is a **compile-time game enum the RON data layer cannot extend**
  (doc 11:304) — so timed buffs, cooldowns, charge meters, shields, and chain counters are
  *Rust* (typed-counter) additions, not pure data, even though they reuse the arena.
- The effect-stack **does not cover** grid tactics, party-of-N-all-act, or ATB/CTB/press-turn.
  Those are different battle models, and doc 09:534 already records the doubles-redirect seam as
  inert and "not a goal."
