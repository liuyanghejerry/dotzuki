# Game Project Spec — zero-Rust jrpg-engine projects

A **game project** is a plain directory of DSL, data, and asset files plus a
single manifest, `.jrpg-editor.json`. There is no Cargo workspace, no
`package.json`, no build system inside a game project: the engine binary and
the editor consume the directory as-is.

This spec is the contract between the tools that create, edit, and run such
projects. The reference implementation of the layout is the editor's
scaffolder (`tools/jrpg-editor/server/scaffold.ts`); the `jrpg` CLI
(`crates/jrpg-cli`) produces the same layout.

## Consumers

| Consumer | What it does with a game project |
|----------|----------------------------------|
| **jrpg-editor** (`tools/jrpg-editor`) | Reads and writes everything: manifest, data tables, maps, scenes, gfx. |
| **`jrpg` CLI** (`crates/jrpg-cli`) | `jrpg new` scaffolds a project; `jrpg check` compile-checks its DSL files. |
| **`jrpg run`** (`crates/jrpg-cli` + `crates/jrpg-runner`) | Boots the project and plays it: overworld, dialogue scenes, warps (see below). |

## Directory layout

```
my-game/
├── .jrpg-editor.json     # project manifest — the only config file
├── README.md             # human notes; free-form
├── data/                 # dataRoot — game data
│   ├── maps/             # map definitions + per-map script .scene files
│   │   └── StartTown/    # editor-scaffolded demo map (map.tmx.json,
│   │                     #   tileset.png, script.scene, map.json)
│   ├── tiles/            # shared tile library (map-editor Backdrop/Trace)
│   └── stories/          # narrative bible: characters/, quests/, arcs/,
│                         #   graph.json (story activity)
├── gfx/                  # gfxRoot — graphics assets (tilesets, sprites)
└── assets/
    └── scenes/           # story scenes, Game DSL (.scene)
        └── main.scene    # starter scene
```

- `data/maps/` — one entry per map. Map activities (`type: "map"`) point here
  via `mapsDir` (relative to `dataRoot`); the script activity's `scriptsDir`
  conventionally points here too, so per-map `*.scene` scripts live next to
  their map data.
- `data/tiles/` — the shared tile library backing the map editor's tile
  picker (activity `type: "tiles"`).
- `gfx/` — loose graphics files. The assets activity lists it in `roots`.
- `assets/scenes/` — story scenes written in the Game DSL. This is the
  default **scene directory** (`game.scenesDir`); see below.

Scaffolders create at minimum: `.jrpg-editor.json`, `README.md`, `data/maps/`,
`data/tiles/`, `gfx/`, `assets/scenes/main.scene`. Templates with data tables
additionally create one `data/<table.dir>/` per table. The **editor's
scaffolder** additionally seeds starter content so a fresh project is
immediately explorable: a `data/maps/StartTown/` demo map with a procedurally
generated tileset (`tileset.png`) and a per-map `script.scene`, a seeded
shared tile library under `data/tiles/`, the `data/stories/` bible skeleton,
and — for the game templates (`jrpg`, `wuxia`) — sample table records plus a
seeded story character and quest. The `jrpg` template is also **battle-ready**
and **shop-ready**: its manifest carries a `battle` section (heroes vs.
monsters with the spells table — both seeded heroes form the switchable
party — plus an `items` block with 3 Potions, an `encounters` block with the
seeded Bug Catcher trainer, and a `levels` block arming
EXP/level growth — the seeded Slime pays 8 EXP on a win), a `shop` section
(`{ "currency": "G", "startMoney": 100 }`), seeded skill records and
combatant `skills` lists, and a `data/rules.ron` type chart — a fresh
project can fight via `@command("startBattle", "slime")` (wild) or
`@command("startBattle", "bug-catcher")` (trainer), and open a Buy/Sell shop
(the seeded Potion costs 20) via `@command("openShop", ["potion"])`
with zero setup.
`jrpg new` emits the minimal skeleton only.

## Manifest schema (`.jrpg-editor.json`)

Top-level object:

| Key | Type | Required | Meaning |
|-----|------|----------|---------|
| `name` | string | yes | Display name (free-form, not necessarily a slug). |
| `dataRoot` | string | yes | Game data root, relative to the project dir. Scaffolders write `"./data"`. |
| `gfxRoot` | string | no | Graphics root, relative to the project dir. Default `"./gfx"`. |
| `activities` | array | yes | Activity definitions (below). Order is preserved by the editor UI. |
| `game` | object | no | Engine-facing section (below). Absent in older editor projects. |
| `battle` | object | no | Battle-system section (see the Battles chapter). |
| `shop` | object | no | Currency section: `{ "currency": "G", "startMoney": 100 }` (both keys optional, those are the defaults). See the Shops chapter. |

### Activities

Each activity is `{ id, type, label, icon, enabled, config }`. `id` is unique
within the manifest; `type` selects the editor pane; `config` is a free-form
per-type object (unknown keys are tolerated). The scaffolded set, in order:

| `id` | `type` | Key `config` fields |
|------|--------|---------------------|
| `maps` | `map` | `mapsDir` (rel. dataRoot), optional `tileSize`, `blockSize` |
| `scripts` | `script` | `scriptsDir` (rel. dataRoot), `extension` (default `".scene"`) |
| `play` | `play` | none (in-editor WASM playtest — see *Editor playtest*) |
| `data` | `data` | `tables`: array of `{ id, label, dir, icon, idField, fields[] }` (table dirs live under dataRoot) |
| `story` | `story` | `storiesDir`, `scenesDir` (both rel. dataRoot), `locales` |
| `assets` | `assets` | `roots` (rel. project dir), optional `extensions` |
| `tiles` | `tiles` | `tilesDir`, `tileSize`, `backdropMapsDir` (all rel. dataRoot) |

One more activity type is defined by the editor and may appear in
hand-grown projects; scaffolders do not emit it:

- `ui` — GUI layouts. `config.guiRoot` (rel. project dir) holds `.gui` files;
  `config.extension` defaults to `".gui"`.

The scaffolded `story` activity uses `storiesDir: "stories"`,
`scenesDir: "maps"` (where its `.scene` files live) and `locales: ["en",
"zh"]`.

### The `game` section

Optional. `jrpg new` writes it; the editor reads and writes projects that
lack it without complaint.

```json
"game": {
  "entryScene": "main",
  "scenesDir": "assets/scenes"
}
```

| Key | Type | Default when absent |
|-----|------|---------------------|
| `scenesDir` | string (rel. project dir) | `"assets/scenes"` |
| `entryScene` | string (scene file stem under `scenesDir`) | The first `.scene` file discovered under `scenesDir`, sorted by path, with its extension stripped |
| `entryMap` | string | The first map directory under the map activity's `mapsDir`, sorted by name |

Derivation rules a consumer applies, in order: resolve `scenesDir`
(`game.scenesDir` or the default), scan it for `.scene` files, and take
`entryScene` from `game.entryScene` or the first discovered scene. `jrpg new`
writes `"entryScene": "main"` matching the scaffolded `main.scene`, so a
fresh project is already consistent. How `jrpg run` consumes both keys is
specified below.

## What `jrpg run` does

`jrpg run <dir>` boots a playable instance of the project (windowed;
`--headless [--frames N] [--screenshot out.png]` for CI/smoke tests). It is
implemented by the `jrpg-runner` crate; this section is the behavioral
contract.

**Boot.** The manifest is loaded, all DSL dirs are compiled (any diagnostic
fails the boot with the same message list `jrpg check` prints), and compiled
scenes are registered by their `game_scene` name. Entry resolution:

- With maps: spawn on `game.entryMap` (or `--map`), else the first map
  directory under `mapsDir`. The player spawns at the map centre, scanning
  outward for the first walkable tile.
- Without maps: dialogue-only mode — the `entryScene` (default derivation
  above) runs its `main` storyline to completion, then an end card shows.

**Maps.** A map is `<mapsDir>/<id>/map.tmx.json` (Tiled JSON; the layer named
`collision` marks blocked tiles, every other layer renders) plus
`tileset.png` (full-color atlas, GIDs 1-based, row-major) plus an optional
objects sidecar — `objects.json` (editor-written) with
`npcs: [{id,name,x,y,facing,sprite,talk}]`, `warps: [{x,y,dest_map,dest_x,dest_y}]`,
`signs: [{x,y,text}]` (face the sign tile + A reads its text as paged
dialogue) and an optional `encounters` block (below)
(legacy `map.json` is read as a fallback). Walking onto a warp tile fades to
the destination map.

**Elevation levels.** Maps may be multi-level (walk on the ground *and* on
wall tops). Collision per level: layers named `collision` (level 0),
`collision1`, `collision2`, … — a non-zero GID is solid at that level; these
layers never render. Missing intermediate levels are treated as all-solid.
A layer named `stairs` marks transition tiles (never rendered): GID 1
ascends one level on arrival, GID 2 descends one (clamped to the map's
levels). Visual layers carry an optional integer custom property `level`
(default 0): layers with `level <= player elevation` render below the
sprites, layers above render over them. Maps with only a `collision` layer
behave exactly as single-level maps.

**Random encounters (`encounters` sidecar block).** A map opts into wild
battles with an `encounters` block in its objects sidecar — the same shape
as pokered's `wild_data`: a per-step `rate` byte in **/256 units** (`25` ≈
9.8% per step) plus tile-rectangle zones, each with a weighted table:

```json
"encounters": {
  "rate": 25,
  "zones": [
    { "x": 0, "y": 5, "w": 8, "h": 3,
      "table": [ { "id": "slime", "weight": 70 }, { "id": "bug-catcher", "weight": 30 } ] }
  ]
}
```

Zone coordinates are map tiles, the rectangle **inclusive** of its `w`×`h`
extent. A completed walk step onto a zoned tile rolls once: one rng byte
`< rate` hits, then a weighted draw from the zone's `table` picks the id
(`weight` is relative, default 1). The id resolves exactly like
`startBattle(id)` — an encounter record first (trainer parties/queues
included), then a single enemy record — and arms a **sceneless** battle (see
the Battles chapter). Step resolution priority is: **warp > encounter roll >
plain walk** — stepping onto a warp tile never rolls, and turning in place
is not a step. Absent (or `null`) `encounters` ⇒ the map never rolls —
older sidecars keep working unchanged.

**Scene dispatch.** On entering a map: fire its `on_enter` routes (from
`@trigger` in the compiled report), else the scene's `<SceneName>OnLoad`,
else its `main` storyline — once, guarded by the `__played_main_<map>` flag.
Talking to an NPC (face + A) runs the storyline named by its `talk` field,
else a route naming that NPC, else the map scene's `main`, else shows `talk`
as raw text. A map's scene is the compiled scene whose source is
`<mapsDir>/<map>/script.scene`, falling back to a scene named like the map.

**Commands.** The scene VM fully supports `showText` (paged textbox),
`showChoice` (menu → index), `warpTo`, `delay`, `fadeScreen`, flags
(`setFlag`/`resetFlag`/`checkFlag`, persisted across scenes for the session),
`startBattle`/`startWildBattle` (see the Battles chapter) and `openShop`
(see the Shops chapter). Any other command logs a warning and auto-completes
rather than deadlocking the scene.

**Menus.** Pressing **Start** in the overworld opens a pause menu (B/Start
closes it; the overworld is frozen underneath) with four entries:

- **Party** — a read-only list of every party-table record: name, HP x/y,
  MP x/y, status, base stats (ATK/DEF/SPD), element, and skill names. No
  reordering in this version.
- **Bag** — the persistent inventory (item → count) plus the player's money.
  Items whose record has a positive heal amount (the same
  `battle.items.healField` convention as battle items) can be used: pick the
  item, pick a party member — it heals (capped at max HP) and the count
  decrements. A fainted member (0 HP) is **not** revived, a full-HP member
  is not healed ("It won't have any effect."), and items without a positive
  heal amount can't be used. Projects without a `battle.items` block list
  their items as unusable.
- **Save** — writes the save file immediately (the same stable-state
  writer; saving from the menu is always allowed, even in headless runs)
  with a "Game saved." confirmation.
- **Close** (or B).

Menu labels follow the runner's language (`--lang en`/`zh`).

**Shops (`shop` manifest section + `openShop`).** The runner owns the
player's **money** (a `u32`), initialized from the manifest's optional
top-level `shop` section — `{ "currency": "G", "startMoney": 100 }`, exactly
those defaults when the section is absent — and carried in the save file
(v3). The currency label shows next to amounts in the shop UI and the Bag.
A scene opens a shop with `@command("openShop", ["potion", "elixir"])`
(`game.openShop([...])` in JS): the scene suspends and the shop UI opens on
a **Buy / Sell / Exit** root (B on a list returns to the root; B or Exit on
the root resumes the scene). **Buy** lists the given items with their record
`price` (default 0) and the player's money. A buys (money −= price,
inventory += 1); unaffordable entries are marked and rejected. **Sell**
lists the player's inventory entries with a positive count, each at
**`floor(price / 2)`** (there is no separate sellPrice field; items priced 0
sell for 0 — allowed). A sells one (money += , count −= 1). Unknown item ids
on the shelf open as name=id, price 0 — a misconfigured shop never deadlocks
the scene. Item records are read through the `battle.items` table.

**Game-over.** Losing a battle no longer strands the player with a 0-HP
party: after the scene that received `"lose"` finishes (its own post-lose
text plays first), the runner runs a **whiteout** — a brief blackout, a
"<Name> collapsed…" line, then the whole party is healed to full HP/MP
(status cleared) and the player returns to the **entry map's spawn point**
(the current map if it is the entry map, otherwise the entry map loads).
Flags, inventory and money are kept. Map-less (dialogue-only) projects just
heal. There is no heal-point system yet: the respawn is always the entry
spawn.

**Audio.** `playMusic`/`playSound`/`stopMusic`/`fadeOutMusic` play tracks
from `data/audio/**/*.json` (jrpg-audio `TrackDef` format; `music/` + `sfx/`
subdirs are a convention — the tree is loaded recursively). The id a scene
passes is the track's `id` field; unknown ids warn once and continue. Audio
is fully optional: no `data/audio/` dir means every command is a silent
no-op with zero device cost, the output device is opened lazily on the first
play command, and a missing/unavailable device (CI, `--headless`) logs once
and continues silent. Audio files are not hot-reloaded by `--watch` (they
load at boot).

**Sprites.** The player uses `gfx/overworld/player/sheet.png` (24×32 cells,
4 facings × 5 frames) when present; otherwise a procedural placeholder person
is drawn. NPCs always render as id-colored placeholders in this version.

**Save/load.** The game saves to `<project>/.jrpg-save.json` (override with
`--save-file`) — versioned JSON: `{version, map, player: {x, y, facing, level?},
flags, lang, party?, inventory?, money?}` (v3; `party`/`inventory` appear
once a battle has completed — see the battle chapter; party members may
carry optional `level`/`exp` fields when the battle has a `levels` block —
absent ⇒ level 1 / 0 EXP; `money` is always written; `player.level` is the
map elevation level, absent ⇒ 0). Saves are written only from **stable** states — after a completed
warp transition and when a scene finishes into the overworld — never
mid-scene or mid-warp (a suspended scene engine can't resume), so closing
the window mid-dialogue keeps the last stable point. The Start menu's
**Save** entry writes the same file on demand (always allowed, even in
headless runs). On boot a valid save resumes: flags are restored, the saved
map loads, the player is placed at the saved tile (spawn-scan fallback if it
became occupied), the party state, inventory and money ride along, and the
opening dispatch is skipped — the restored `__played_main_*` flags keep
`main` from replaying on later entries. Loading accepts any version `<=`
the current one with per-field defaults — **v1/v2 saves still resume** (no
`party`/`inventory` ⇒ both start fresh; no `money` ⇒ the manifest's
`shop.startMoney` default applies); a missing/corrupt/**newer**-version save
warns and boots fresh. `--fresh` ignores the save; `--map` overrides its
map. Windowed runs always write saves; `--headless` never writes unless
`--save` is passed (CI stays side-effect-free).

**Hot reload.** With `--watch` (windowed mode only), the running game watches
the data/gfx/scene directories: a `.scene` edit recompiles the DSL and swaps
scenes in place (a broken edit keeps the old scenes running; diagnostics are
logged), and an edit to the *current* map's `map.tmx.json` / `tileset.png` /
objects sidecar reloads that map in place, preserving the player position and
flags. Other maps, data tables and gfx are picked up on next enter / boot.

**Not yet implemented** (scenes relying on these warn and continue): the
`StackDriver` turn loop.

## Battles (`battle` manifest section)

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

- `party` / `enemies` name **data-table ids** from the data activity's
  `config.tables[]` (their `dir`s hold the records). A battle needs both;
  a referenced id that names no declared table is a boot-time error *when a
  battle actually starts* (projects that never battle are unaffected) — and a
  `jrpg check` diagnostic regardless.
- `encounters` (optional) names an **encounter table**: its records describe
  enemy parties and trainer battles — `{ "id": "gym-leader-1", "name":
  "Leader Kai", "enemies": ["slime", "bat"], "trainer": true, "money": 80 }`.
  `enemies` is an ordered list of enemy-table record ids (an empty list or
  an unknown id inside it is a clear error at battle start), `trainer`
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
  the jrpg-rules `Ruleset` model **only when the file exists**. Its
  `type_chart` feeds the effectiveness multiplier, and — when it declares
  `effects` — those records are **live**: `kind: Move` records take
  over matching skills and `kind: Status` records define statuses, executed
  through the engine's effect-stack interpreter (see **RON effect hooks**
  below); `kind: Ability`/`Item`/`Weather` records back combatant abilities,
  held items and scene-armed weather (see **Abilities, held items &
  weather** below). A rules file that fails to parse *or compile* (unknown
  event/op/stat/type/resource/status name in a hook) is a boot-time error at
  battle start and a `jrpg check` diagnostic.
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
    keep loading). The menu Party view shows `Lv` and an `EXP <progress>/<need>` line (only with the block).

**Records.** A combatant is one `<dataRoot>/<tableDir>/<id>.json` record:
`name` (display, else the id), the four stat fields, the `resource` field,
an optional `element` string (the defending side of type-chart lookups), and
the skill-id list. Two more optional fields hook the RON effect kinds:
`ability` (a `kind: Ability` record id) and `heldItem` (a `kind: Item`
record id) — see below. `startBattle("x")` resolves in this order: with an
`encounters` block, an **encounter record** `x` (an enemy party, below);
else a single **enemy record** `x` (implicitly wild); an id in neither table
falls back to the first enemy record with a warning.

**Encounters (enemy parties + trainer battles).** With an `encounters`
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

**Parties.** The player's party is **every record of the party table**
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

**Items in battle.** With an `items` block, the runner owns a persistent
**inventory** (record id → count, initialized from `starting` at first boot,
carried in the save file). The Item menu lists the usable items (records
whose `healField` number is positive) that still have a count; using one
heals the ACTIVE member by that amount (capped at max HP), decrements the
count, and consumes the player's turn. An item at count 0 is no longer
listed.

**Skills.** A skill record: `name`, `power` (default 0), `accuracy`
(default 100), optional `element`, `stat` (which stat a buff/debuff moves —
a `stats` key like `"attack"`/`"defense"`, default attack), the category
field (case-insensitive: `attack`/`damage` → damage, `heal` → restore own HP
by `power` capped at max, `buff` → own stat stage +1, `debuff` → target stat
stage −1, unrecognized → attack), and the cost field (default 0). Unknown
skill ids in a combatant's list are skipped with a warning; an empty/missing
list (or no skills table at all) yields the built-in **Attack** (power 40,
accuracy 100, no cost).

**The standard formula.** Per damaging hit, integer math:
`base = power × eff_atk / max(1, eff_def)` where an eff stat is the raw stat
× the stage multiplier (stages clamp to −4..+4: ×(4+stage)/4 above 0,
×4/(4−stage) below — +1 = ×1.25, −1 = ×0.8); then variance ×(85+rng%16)/100;
then a 1/16 crit (rng%16 == 0) ×1.5; then the type-chart multiplier
(skill `element` vs defender `element`, no edge ⇒ 1×). `damage = max(1, …)`.
Accuracy: the hit lands iff `rng % 100 < accuracy`. Every skill use consumes
one accuracy byte; damaging skills then consume the variance and crit bytes.

**Precedence (v2-a).** When the rules file declares a `kind: Move` record
whose `id` matches a skill id, the RON record **takes over** the skill: its
`power`/`type`/`accuracy`/`cost` fields override the table record (absent
fields fall back to the table record), and the action runs through the
effect stack instead of the built-in category behavior. In short: **RON
record > table record > built-in category**. Skills with NO matching RON
record behave exactly as v1, even in a project whose rules file has effects.

**RON effect hooks (v2-a).** Hooks are authored in the rules file's
`effects` records with the jrpg-rules closed `Op`/`Predicate` vocabulary
(`workspace/crates/jrpg-rules/src/model.rs` — `Boost`, `InflictStatus`,
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

**Abilities, held items & weather.** The remaining RON kinds are live, wired
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

**Turn loop.** Each round: the player picks a root-menu action — **Fight**
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

**Scene integration.** `result = startBattle("slime")` (or
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
the Game-over paragraph above): the party is healed and the player returns
to the entry spawn.

**Sceneless battles (random encounters).** A battle armed by walking (the
objects sidecar's `encounters` block — see the Maps section) has no scene
to resume, so its outcomes flow straight back into the overworld: a **win**
or a **run** returns to `Mode::Overworld` in place (the player keeps
walking from the encounter tile; EXP/level-ups/trainer money and the
party-state/inventory harvest behave exactly as after a scene battle), and
a **loss** triggers the game-over whiteout directly (no post-lose text —
there is no scene to play it). All other battle semantics — the resolution
order of the drawn id (encounter record → single enemy record), trainer
battles blocking Run, EXP sums, abilities/weather — are identical to a
scene-triggered battle.

**Remaining limits.** Every RON `EffectKind` now fires (Move / Status /
Ability / Item / Weather); what remains: volatiles are basic
(`InflictVolatile` installs, `HasVolatile` reads — nothing expires them);
HP/MP clamp into the engine's `u16` pools for RON skills; items only heal
(no status cures / revives / battle-only effects) and held items are never
consumed; a defender's ability/held-item hooks don't join the attacker's
per-action fold; weather is scene-armed only (no in-battle op sets it).
Later PRs:
`StackDriver` migration, a heal-point system (the whiteout
always respawns at the entry spawn).

## What `jrpg check` compiles

`jrpg check <dir>` loads the manifest, collects every directory that may hold
DSL files, and runs `jrpg_engine_dsl::compiler::compile_dirs` over them (in
memory, no artifacts written). The directory set is:

1. the scene directory (`game.scenesDir`, default `assets/scenes`, rel.
   project dir);
2. each `script` activity's `scriptsDir` (rel. dataRoot);
3. each `story` activity's `scenesDir` (rel. dataRoot, default `"maps"`);
4. each `ui` activity's `guiRoot` (rel. project dir).

Duplicates are removed; directories that do not exist are skipped (an old
project without `assets/scenes/` therefore still checks its data-root
scenes). `check` prints artifact counts (`N scene(s), M layout(s), …`) plus
all diagnostics, and exits 1 when any diagnostic fires, else 0.

When the manifest has a `battle` section, `check` also validates it: the
referenced table ids (party/enemies/encounters/skills/items) must exist in the data
activity's `config.tables[]`, the referenced stat/skill fields and the items
`healField` must exist in the table schemas, an `encounters` block's table
must declare an `enemies` field, and the rules file (when
present on disk) must parse as a jrpg-rules `Ruleset` AND compile against
the closed vocabulary — an unknown event, op, or stat/type/resource/status
name in a hook is a diagnostic, exactly as it would be a boot-time error at
battle start.
Battle diagnostics print and fail the exit code like DSL diagnostics.
Record JSONs are not loaded — the manifest's table definitions suffice.

## Editor playtest (WASM runner)

The editor's `play` activity runs the same `RunnerGame` **in the browser** via
`crates/jrpg-runner-web` (wasm-bindgen), so playtesting needs no Rust
toolchain. The contract with the runner:

- **Bundle.** `GET /api/play/bundle` returns the whole project as
  `{ files: { "<project-relative posix path>": "<base64>" }, projectRoot }`,
  excluding `node_modules`/`.git`/`target`/`dist`, `*.bak` and dotfiles other
  than `.jrpg-editor.json` (16 MB/file, 64 MB total caps). Paths keep the
  `data/maps/<id>/script.scene` shape the runner's scene↔map matching expects.
- **Boot.** The bundle feeds `vfs::MemoryFiles` and
  `LoadedProject::load_with_files` — the exact boot path of `jrpg run`,
  minus the disk. `RunnerOptions` force `watch=false`, headless (no audio
  device), `pcm_audio=true` and no disk saves.
- **Frames.** The page calls `tick(input_bitmask)` at ~59.7 Hz and blits the
  returned 320×240 RGBA frame. Input bitmask matches `GbButton` bit order
  (bit0=A … bit7=Down).
- **Audio.** Instead of a cpal device, the runner renders APU PCM per tick
  (`RunnerGame::render_audio`, 44.1 kHz stereo f32); the page drains it via
  `take_audio()` into a WebAudio queue (`usePlayAudio`). Same sequencer/fade
  path as native, just a pull model instead of the callback thread.
- **Saves.** `export_save()`/`import_save(json)` replace `.jrpg-save.json`;
  the editor persists them to `localStorage`. `export_save` returns nothing
  while a scene/battle/shop/warp transition is suspended — the editor simply
  retries on its interval.

Differences from native `jrpg run`: no file watching (the
editor's **Restart** button re-fetches the bundle and reboots, restoring the
save), audio output goes through the browser's `AudioContext` instead of a
cpal device, and battle RNG is seeded without wall-clock time. Everything
else — maps, dialogue, choices, battles, shops, menus, game-over flow — is
the same code.

## Compatibility rules

- **`.jrpg-editor.json` is the only manifest.** No tool may require a second
  config file in a game project.
- **Unknown keys are tolerated.** Readers must ignore keys they do not know
  (top-level, per-activity, and inside `config`); a tool that rewrites the
  manifest should preserve them. The same holds for the per-map
  `objects.json` sidecar: the editor passes keys it does not know (e.g. a
  hand-authored `encounters` block) through untouched.
- **Sidecar precedence is `objects.json` over `map.json`.** `jrpg new` and
  older projects scaffold `map.json`, but once the editor saves a map's
  entities it writes `objects.json`, which then shadows `map.json` (the
  runner reads `objects.json` first and only falls back). Known current
  behavior, recorded here — not changed.
- **The `game` section is optional.** The editor fully supports projects
  without it; CLI consumers apply the defaults above.
- **Round-trip guarantee.** `jrpg new` output opens in the editor unchanged,
  and an editor-wizard project passes `jrpg check`. Both scaffolders emit the
  same layout, the same seven activities (maps, scripts, play, data, story,
  assets, tiles) with the same config shapes, and structurally equal starter
  scenes. The intentional differences: the `game` section (only `jrpg new`
  writes it), and the starter *content* — the editor's scaffolder seeds the
  demo map, tile library, sample records, and story bible described above,
  while `jrpg new` emits the minimal skeleton.
