# Battles

The `battle` manifest section: config, rules.ron hooks, turn loop, and `check` validation.

> - **Audience**: game authors, rust developers
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.1.0

A project opts into the generic, data-driven battle system (parties +
battle-usable items) with a top-level `battle` section (all keys optional;
the defaults shown):

```json
"battle": {
  "party":      { "table": "heroes" },
  "enemies":    { "table": "monsters" },
  "encounters": { "table": "encounters" },
  "skills":   { "table": "spells", "field": "skills", "categoryField": "type", "costField": "mpCost" },
  "stats":    { "hp": "hp", "attack": "atk", "defense": "def", "speed": "spd" },
  "resource": "mp",
  "rules":    "data/rules.ron",
  "items":    { "table": "items", "healField": "healHp", "starting": { "potion": 3 } },
  "levels":   { "expField": "exp", "levelField": "level",
                "curve": { "base": 8, "exponent": 3 }, "growth": 0.05, "maxLevel": 100 }
}
```

## Configuration

- `party` / `enemies` name **data-table ids** from the data activity's
  `config.tables[]` (their `dir`s hold the records). A battle needs both;
  a referenced id that names no declared table is a boot-time error *when a
  battle starts* (projects that never battle are unaffected) — and a
  `dotzuki check` diagnostic regardless.
- `encounters` (optional) names an **encounter table**: its records describe
  enemy parties and trainer battles — `{ "id": "gym-leader-1", "name":
  "Leader Kai", "enemies": ["slime", "bat"], "trainer": true, "money": 80 }`.
  `enemies` is an ordered list of enemy-table record ids (an empty list or
  an unknown id inside it is a definite error at battle start), `trainer`
  defaults to `false`, and `money` (the win reward, paid only by trainer
  encounters) defaults to 0. Absent ⇒ every battle is a single wild enemy
  (v1 behavior). See **Encounters** below.
- `skills` names the skills table plus field names: `field` (the combatant
  record's skill-id list, default `"skills"`), `categoryField` (default
  `"type"`), `costField` (default `"mpCost"`). No `skills` key ⇒ every
  combatant has only the built-in Attack.
- `stats` maps the four stat roles to record field names (defaults
  hp/atk/def/spd). A missing/invalid stat field reads as 1. An optional
  `level` field on records (default 1) is read by level-based RON
  ops/predicates (`SetDamage`, `LevelGE`) — and, with a `levels` block,
  also drives stat growth (see below).
- `resource` names the record field holding the MP pool; absent ⇒ no
  resource gate (every skill is free).
- `rules` (project-root-relative, default `data/rules.ron`) is parsed with
  the dotzuki-rules `Ruleset` model **only when the file exists**. Its
  `type_chart` feeds the effectiveness multiplier, and — when it declares
  `effects` — those records are **live**: `kind: Move` records take
  over matching skills and `kind: Status` records define statuses, executed
  through the engine's effect-stack interpreter (see **RON effect hooks**
  below); `kind: Ability`/`Item`/`Weather` records back combatant abilities,
  held items and scene-armed weather (see **Abilities, held items &
  weather** below). A rules file that fails to parse *or compile* (unknown
  event/op/stat/type/resource/status name in a hook) is a boot-time error at
  battle start and a `dotzuki check` diagnostic.
- `items` (optional) arms the battle **Item menu**: `table` names the items
  table, `healField` (default `"healHp"`) the record field whose positive
  number makes an item battle-usable (the heal amount), and `starting` the
  inventory (record id → count) the game boots with. No `items` key ⇒ no
  Item menu. Free-text `effect` fields on item records are **display-only**.
- `levels` (optional) arms **EXP and level growth** (every key optional, the
  defaults shown above). Absent ⇒ today's exact behavior: no EXP is earned,
  stats never grow, and a record's `level` field only feeds RON level-ops.
  With the block:
  - **Stat growth** — every effective stat (both sides, wherever raw record
    stats are read: battle build, the RON mirror, the menu Party view) is
    `floor(raw × (1 + growth × (level − 1)))`, with `level` from the
    record's `levelField` (default `"level"`; missing ⇒ 1 ⇒ ×1, numerically
    identical to a no-levels project). A level-5 enemy record is genuinely
    stronger.
  - **EXP award** — on a win, each NON-fainted party member gains the
    SUM of every defeated enemy's `expField` value (0 when a record lacks
    it), once per battle, narrated after the win text (`"Aria gained 8
    EXP!"`). A single-enemy battle's sum is its enemy's value, identical to
    v1.
  - **Level-ups** — each member tracks `exp` progress toward the next
    level; `exp_to_next(L) = curve.base × L^curve.exponent` (integer).
    While `exp >= exp_to_next(level)` and `level < maxLevel`: level up,
    `exp -= exp_to_next(level)` (multiple level-ups from one award
    supported), narrated (`"Aria grew to level 2!"`). A level-up recomputes
    the member's stats with the growth multiplier and heals the max-HP/MP
    **delta** into the current pools (max HP 60 → 63 at level 2 raises
    current HP by 3; MP likewise).
  - **Persistence** — per-member `level` + `exp` ride the runner's party
    state and the save (`party[].level` / `party[].exp` are OPTIONAL fields;
    absent ⇒ level 1 / 0 EXP, so the save version stays 3 and older saves
    keep loading). The menu Party view shows `Lv` and an
    `EXP <progress>/<need>` line (only with the block).

The `levels` block schema lives in [Level growth](data-tables/levels.md).

## Records

The combatant record schema lives in
[Combatant records](data-tables/combatants.md).

A combatant is one `<dataRoot>/<tableDir>/<id>.json` record:
`name` (display, else the id), the four stat fields, the `resource` field,
an optional `element` string (the defending side of type-chart lookups), and
the skill-id list. Two more optional fields hook the RON effect kinds:
`ability` (a `kind: Ability` record id) and `heldItem` (a `kind: Item`
record id) — see below. `startBattle("x")` resolves in this order: with an
`encounters` block, an **encounter record** `x` (an enemy party, below);
else a single **enemy record** `x` (implicitly wild); an id in neither table
falls back to the first enemy record with a warning.

## Encounters (enemy parties + trainer battles)

The encounter record schema lives in
[Encounter records](data-tables/encounters.md).

With an `encounters`
block, the enemy side of an encounter battle is a **queue**: when the active
enemy faints the next one is sent out — narrated (`"Foe sent out Bat!"`) —
as a fresh combatant (its own stats/level, no status; the RON mirror is
rebuilt and the old enemy's volatiles drop), and the round ends (the
replacement never acts the turn it comes in; the enemy AI is unchanged, per
active combatant). The battle is **won when the queue empties**; the EXP
award is the SUM of every defeated enemy's `expField` (see above). A
`trainer: true` encounter pays its `money` to the player's money on a win —
narrated (`"Got 80 G for winning!"`) — and blocks the Run action (below).
The player side is unchanged: party/switch/items/whiteout behave exactly as
in a wild battle, and an all-fainted party still loses even with enemies
remaining.

## Parties

The player's party is **every record of the party table**
(sorted by record id; a 1-record party behaves like v1). Base stats are
rebuilt from the records at every battle start, but each member's **current
HP/MP and status persist between battles** — the runner owns that party
state, harvests it at the end of every battle (win, lose AND run), and
carries it
in the save file (`party`). A member at 0 HP stays fainted until healed
(items are the only healing source so far). The first LIVING member leads;
a party with no living member loses on the spot. In battle the root menu
offers **Fight** (the skill menu), **Party** (the member list with HP and
status — switching to a living, non-active member consumes the player's
turn, and the enemy's action then resolves against the NEW member),
**Item** (when configured), and **Run** — in a WILD battle Run always
succeeds: narration `"Got away safely!"`, the battle ends with the `"run"`
outcome (no EXP, no money; the party state carries over as after any
battle). In a TRAINER battle Run is blocked — `"Can't escape from a trainer
battle!"` — and the turn is NOT consumed (the menu returns). When the active
member faints the player is
FORCED to pick a replacement: a free action mid-round, after which the
enemy's remaining action this round still resolves (against the new member
if the faint happened first). With no living member left, the battle is
lost. Stat stages reset on switch-in; a member's status persists with the
member (the RON mirrors are rebuilt from the member's current state on
switch, and the old battler's volatiles drop).

## Items in battle

The item record schema lives in [Item records](data-tables/items.md).

With an `items` block, the runner owns a persistent
**inventory** (record id → count, initialized from `starting` at first boot,
carried in the save file). The Item menu lists the usable items (records
whose `healField` number is positive) that still have a count; using one
heals the ACTIVE member by that amount (capped at max HP), decrements the
count, and consumes the player's turn. An item at count 0 is no longer
listed.

## Skills

The skill record schema lives in [Skill records](data-tables/skills.md).

A skill record: `name`, `power` (default 0), `accuracy`
(default 100), optional `element`, `stat` (which stat a buff/debuff moves —
a `stats` key like `"attack"`/`"defense"`, default attack), the category
field (case-insensitive: `attack`/`damage` → damage, `heal` → restore own HP
by `power` capped at max, `buff` → own stat stage +1, `debuff` → target stat
stage −1, unrecognized → attack), and the cost field (default 0). Unknown
skill ids in a combatant's list are skipped with a warning; an empty/missing
list (or no skills table at all) yields the built-in **Attack** (power 40,
accuracy 100, no cost).

## The standard formula

Per damaging hit, integer math:
`base = power × eff_atk / max(1, eff_def)` where an eff stat is the raw stat
× the stage multiplier (stages clamp to −4..+4: ×(4+stage)/4 above 0,
×4/(4−stage) below — +1 = ×1.25, −1 = ×0.8); then variance ×(85+rng%16)/100;
then a 1/16 crit (rng%16 == 0) ×1.5; then the type-chart multiplier
(skill `element` vs defender `element`, no edge ⇒ 1×). `damage = max(1, …)`.
Accuracy: the hit lands iff `rng % 100 < accuracy`. Every skill use consumes
one accuracy byte; damaging skills then consume the variance and crit bytes.

## Precedence (v2-a)

When the rules file declares a `kind: Move` record
whose `id` matches a skill id, the RON record **takes over** the skill: its
`power`/`type`/`accuracy`/`cost` fields override the table record (absent
fields fall back to the table record), and the action runs through the
effect stack instead of the built-in category behavior. In short: **RON
record > table record > built-in category**. Skills with NO matching RON
record behave exactly as v1, even in a project whose rules file has effects.

## RON effect hooks (v2-a)

Hooks are authored in the rules file's
`effects` records with the dotzuki-rules closed `Op`/`Predicate` vocabulary
(`workspace/crates/dotzuki-rules/src/model.rs` — `Boost`, `InflictStatus`,
`DamageFraction`, `HealFraction`, `ScaleRelay`, `VetoIf`, `ApplyTypeChart`,
`PayResource`, `InflictVolatile`, `SetHp`, `SetDamage`, `RepeatHits`,
`RemoveStatus`, and the `HasType`/`TargetHasStatus`/`SourceHasStatus`/
`SelfHpBelow`/`LevelGE`/… predicates). Naming conventions:

- RON `stats` names are the manifest `battle.stats` **keys**
  (`"hp"|"attack"|"defense"|"speed"`; the usual `atk`/`def`/`spd` aliases
  also resolve), so `Boost { stat: "attack" }` needs no per-game code.
- RON `resources` names are the manifest `battle.resource` field name (e.g.
  `"mp"`); a move record's `cost: [Cost(resource: "mp", amount: N)]` flows
  through the same MP gate as table costs (menu marking + resolution-time
  re-check), and `PayResource` ops read the same pool.
- RON `types` names are the `element` strings on records (as the chart
  already required), matched case-insensitively.
- The status vocabulary is the ids of the ruleset's `kind: Status` records;
  `InflictStatus { status: "poison" }` inflicts one, and its `Residual`
  hooks run **after each action of the afflicted combatant** (poison chip),
  narrated (`"Aria was afflicted with poison!"`, `"Slime is hurt by
  poison!"`, `"Aria is no longer poison!"`).

Per action with a taken-over skill, the runner fires this event sequence
through the stack (the minimon/wuxia harness order): MP gate → accuracy →
`BeforeMove` gate (only when the record subscribes; a `VetoIf`/`PayResource`
`Fail` blocks the action) → damage precompute (the standard formula, written
into `ctx.mv.damage`) → `ModifyDamage` → `Effectiveness` → `Damage` → apply
→ `DamagingHit` (after any landed hit, damaging or not — a power-0 status
skill's riders live here) → `AfterMove`. When the record subscribes to
`Effectiveness` the hooks own the scaling — author `ApplyTypeChart` in an
`Effectiveness` hook to get the type chart; when it does NOT subscribe, the
v1 direct chart application applies in the precompute (so a record that only
overrides `power`/`type` keeps the chart behavior you expect).

## Abilities, held items & weather

The remaining RON kinds are live, wired
by record fields and a scene command — no manifest changes:

- **Abilities** (`kind: Ability` records, named by a combatant record's
  optional `ability` field). The ACTIVE combatants' ability hooks fire at
  battle start and on every switch-in (a voluntary/forced player switch, an
  encounter send-out) on the `SwitchIn` event — benched members' abilities
  are inert. A switch-in fire narrates an intro line (`"Aria's
  Intimidate!"` — the record id prettified, since records carry no display
  name) before the usual diff lines (`"Slime's Attack fell!"`). Ability
  hooks also join the acting combatant's per-action event sequence: an
  ability hooking `ModifyDamage`/`DamagingHit`/… fires alongside the skill's
  own hooks, with the same `Source` (the actor) and `Target` (the foe).
- **Held items** (`kind: Item` records, named by a combatant record's
  optional `heldItem` field). They fire exactly like abilities, plus their
  `Residual` hooks run after each of the holder's actions (a Leftovers-style
  `HealFraction`). Held items are **persistent flags — nothing consumes
  them** (berries/consumption are out of scope); a `heldItem` id whose
  `healField` is 0 never appears in the Item menu.
- **Weather** (`kind: Weather` records, armed by a scene). `game.
  setWeather("sandstorm")` arms a weather record for the NEXT battle and
  `game.clearWeather()` cancels a previously armed one (both resolve
  immediately, like flag commands). The weather is **battle-local**: the
  battle narrates its start (`"A sandstorm rages!"`, from the record id),
  its `FieldResidual` hooks fire on each combatant's residual every round
  while active (both sides, per the ops' `target`), and it is dropped when
  the battle ends — never saved. An armed id that names no compiled record
  warns and is ignored. In-battle weather-setting (a move op) is NOT
  supported — the `Op` vocabulary has no weather op; scenes are the only
  trigger.

Limits of the wiring: only the ACTING combatant's ability/held-item hooks
join its per-action sequence (a defender's ability fires on its own
switch-in/residual, not in the attacker's fold), and residuals (status, held
item, weather) fire after a combatant's own action — on switch/item rounds
only the enemy's residual runs, as with statuses.

## Turn loop

Each round: the player picks a root-menu action — **Fight**
opens the skill menu (name + cost; unaffordable skills are marked and
unselectable), **Party** switches (consumes the turn), **Item** uses one
(consumes the turn), **Run** ends a wild battle (blocked in trainer
battles, turn not consumed); the enemy AI picks its highest-power
affordable skill
(fallback: first affordable, else the built-in Attack). For Fight rounds the
faster side (eff speed) acts first, ties go to the player; switch/item
rounds act player-first. Each action re-checks the MP gate, rolls accuracy,
resolves (v1 category or RON hooks) and narrates (`"Slime used Tackle!"`,
`"Critical hit!"`, `"It's super effective!"`, `"48 damage!"`, `"Aria's
Attack rose!"`, `"Come back, Aria!"`, `"Go, Bryn!"`, `"Aria used
Potion!"`); the acting side's status residuals then fire. The enemy at 0 HP
sends out the next queued enemy (encounters) or ends the battle in a win;
the active member at 0 HP forces a replacement
while the party has living members, else the battle is lost; a successful
Run ends it on the spot: the scene
resumes with `"win"`, `"lose"` or `"run"`. The loop is the runner's own phase
machine, not the engine's `StackDriver`; RON hooks fire per event through
the effect-stack interpreter (`collect_handlers` + `run_event`), the
minimon/wuxia harness pattern.

## Scene integration

`result = startBattle("slime")` (or
`@command("startBattle", "slime")`) suspends the scene, runs the battle, and
resumes with `result == "win" | "lose" | "run"` — branch with `@if` and set
flags as usual; flags are harvested when the scene ends. **The `"run"`
outcome is a contract change**: scenes branching on `result == "win"` treat
a run as not-won (their `@else` arm runs); an explicit
`@if (result == "run")` branch distinguishes it from a loss. A run awards no
EXP and no money, and the party state carries over as after any battle.
`startWildBattle(species,
level)` behaves the same (v1 ignores `level`). `setWeather(id)` /
`clearWeather()` arm or cancel the next battle's weather (see **Abilities,
held items & weather** above). A project **without** a
`battle` section warns and auto-completes with `"win"` (undefeated-continue,
like any unimplemented command). A lost battle returns `"lose"` to the scene
(its post-lose text plays), then triggers the **game-over whiteout** (see
[Game-over](project-manifest.md#game-over)): the party is healed and the player
returns to the entry spawn.

## Sceneless battles (random encounters)

A battle armed by walking (the
objects sidecar's `encounters` block — see [Maps](../how-to/maps.md)) has no scene
to resume, so its outcomes flow straight back into the overworld: a **win**
or a **run** returns to `Mode::Overworld` in place (the player keeps
walking from the encounter tile; EXP/level-ups/trainer money and the
party-state/inventory harvest behave exactly as after a scene battle), and
a **loss** triggers the game-over whiteout directly (no post-lose text —
there is no scene to play it). All other battle semantics — the resolution
order of the drawn id (encounter record → single enemy record), trainer
battles blocking Run, EXP sums, abilities/weather — are identical to a
scene-triggered battle.

## Remaining limits

Every RON `EffectKind` now fires (Move / Status /
Ability / Item / Weather); what remains: volatiles never expire
(`InflictVolatile` installs, `HasVolatile` reads — nothing removes them);
HP/MP clamp into the engine's `u16` pools for RON skills; items only heal
(no status cures / revives / battle-only effects) and held items are never
consumed; a defender's ability/held-item hooks don't join the attacker's
per-action fold; weather is scene-armed only (no in-battle op sets it).
Later PRs:
`StackDriver` migration, a heal-point system (the whiteout
always respawns at the entry spawn).

## Validation by `dotzuki check`

When the manifest has a `battle` section, `check` also validates it: the
referenced table ids (party/enemies/encounters/skills/items) must exist in the data
activity's `config.tables[]`, the referenced stat/skill fields and the items
`healField` must exist in the table schemas, an `encounters` block's table
must declare an `enemies` field, and the rules file (when
present on disk) must parse as a dotzuki-rules `Ruleset` AND compile against
the closed vocabulary — an unknown event, op, or stat/type/resource/status
name in a hook is a diagnostic, exactly as it would be a boot-time error at
battle start.
Battle diagnostics print and fail the exit code like DSL diagnostics.
Record JSONs are not loaded — the manifest's table definitions suffice.
