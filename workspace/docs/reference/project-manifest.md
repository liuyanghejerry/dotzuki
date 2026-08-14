# Game Project Spec — zero-Rust dotzuki-engine projects

The zero-Rust project contract: directory layout, manifest schema, and run/check/playtest behavior.

> - **Audience**: game authors, tool developers
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.1.0

A **game project** is a plain directory of DSL, data, and asset files plus a
single manifest, `.dotzuki-editor.json`. There is no Cargo workspace, no
`package.json`, no build system inside a game project: the engine binary and
the editor consume the directory as-is.

This spec is the contract between the tools that create, edit, and run such
projects. The reference implementation of the layout is the editor's
scaffolder (`tools/dotzuki-editor/server/scaffold.ts`); the `dotzuki` CLI
(`crates/dotzuki-cli`) produces the same layout.

## Consumers

| Consumer | What it does with a game project |
|----------|----------------------------------|
| **dotzuki-editor** (`tools/dotzuki-editor`) | Reads and writes everything: manifest, data tables, maps, scenes, gfx. |
| **`dotzuki` CLI** (`crates/dotzuki-cli`) | `dotzuki new` scaffolds a project; `dotzuki check` compile-checks its DSL files. |
| **`dotzuki run`** (`crates/dotzuki-cli` + `crates/dotzuki-runner`) | Boots the project and plays it: overworld, dialogue scenes, warps (see below). |

## Directory layout

```
my-game/
├── .dotzuki-editor.json     # project manifest — the only config file
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

Scaffolders create at minimum: `.dotzuki-editor.json`, `README.md`, `data/maps/`,
`data/tiles/`, `gfx/`, `assets/scenes/main.scene`. Templates with data tables
additionally create one `data/<table.dir>/` per table. The **editor's
scaffolder** additionally seeds starter content so a fresh project is
immediately explorable: a `data/maps/StartTown/` demo map with a procedurally
generated tileset (`tileset.png`) and a per-map `script.scene`, a seeded
shared tile library under `data/tiles/`, the `data/stories/` bible skeleton,
and — for the game templates (`dotzuki`, `wuxia`) — sample table records plus a
seeded story character and quest. The `dotzuki` template is also **battle-ready**
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
`dotzuki new` emits the minimal skeleton only.

## Manifest schema (`.dotzuki-editor.json`)

Top-level object:

| Key | Type | Required | Meaning |
|-----|------|----------|---------|
| `name` | string | yes | Display name (free-form, not necessarily a slug). |
| `dataRoot` | string | yes | Game data root, relative to the project dir. Scaffolders write `"./data"`. |
| `gfxRoot` | string | no | Graphics root, relative to the project dir. Default `"./gfx"`. |
| `activities` | array | yes | Activity definitions (below). Order is preserved by the editor UI. |
| `game` | object | no | Engine-facing section (below). Absent in older editor projects. |
| `battle` | object | no | Battle-system section (see [the battle rules](battle-rules.md)). |
| `shop` | object | no | Currency section: `{ "currency": "G", "startMoney": 100 }` (both keys optional, those are the defaults). See [Shops](#shops). |

### Activities

Each activity is `{ id, type, label, icon, enabled, config }`. `id` is unique
within the manifest; `type` selects the editor pane; `config` is a free-form
per-type object (unknown keys are tolerated). The scaffolded set, in order:

| `id` | `type` | Key `config` fields |
|------|--------|---------------------|
| `maps` | `map` | `mapsDir` (rel. dataRoot), optional `tileSize`, `blockSize` |
| `scripts` | `script` | `scriptsDir` (rel. dataRoot), `extension` (default `".scene"`) |
| `play` | `play` | none (in-editor WASM playtest — see [Editor playtest](#editor-playtest-wasm-runner)) |
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

Optional. `dotzuki new` writes it; the editor reads and writes projects that
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
`entryScene` from `game.entryScene` or the first discovered scene. `dotzuki new`
writes `"entryScene": "main"` matching the scaffolded `main.scene`, so a
fresh project is already consistent. How `dotzuki run` consumes both keys is
specified below.

## What `dotzuki run` does

`dotzuki run <dir>` boots a playable instance of the project (windowed;
`--headless [--frames N] [--screenshot out.png]` for CI/smoke tests). It is
implemented by the `dotzuki-runner` crate; this section is the behavioral
contract.

### Boot

The manifest is loaded, all DSL dirs are compiled (any diagnostic
fails the boot with the same message list `dotzuki check` prints), and compiled
scenes are registered by their `game_scene` name. Entry resolution:

- With maps: spawn on `game.entryMap` (or `--map`), else the first map
  directory under `mapsDir`. The player spawns at the map centre, scanning
  outward for the first walkable tile.
- Without maps: dialogue-only mode — the `entryScene` (default derivation
  [above](#the-game-section)) runs its `main` storyline to completion, then an
  end card shows.

### Maps

A map is `<mapsDir>/<id>/map.tmx.json` (Tiled JSON; the layer named
`collision` marks blocked tiles, every other layer renders) plus
`tileset.png` (full-color atlas, GIDs 1-based, row-major) plus an optional
objects sidecar — `objects.json` (editor-written) with
`npcs: [{id,name,x,y,facing,sprite,talk}]`, `warps: [{x,y,dest_map,dest_x,dest_y}]`,
`signs: [{x,y,text}]` (face the sign tile + A reads its text as paged
dialogue) and an optional `encounters` block (below)
(legacy `map.json` is read as a fallback). Walking onto a warp tile fades to
the destination map.

The authoring workflow for these files lives in [Maps](../how-to/maps.md).

### Elevation levels

Maps may be multi-level (walk on the ground *and* on
wall tops). Collision per level: layers named `collision` (level 0),
`collision1`, `collision2`, … — a non-zero GID is solid at that level; these
layers never render. Missing intermediate levels are treated as all-solid.
A layer named `stairs` marks transition tiles (never rendered): GID 1
ascends one level on arrival, GID 2 descends one (clamped to the map's
levels). Visual layers carry an optional integer custom property `level`
(default 0): layers with `level <= player elevation` render below the
sprites, layers above render over them. Maps with only a `collision` layer
behave exactly as single-level maps.

### Random encounters

A map opts into wild
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
[the battle rules](battle-rules.md)). Step resolution priority is: **warp > encounter roll >
plain walk** — stepping onto a warp tile never rolls, and turning in place
is not a step. Absent (or `null`) `encounters` ⇒ the map never rolls —
older sidecars keep working unchanged.

### Scene dispatch

On entering a map: fire its `on_enter` routes (from
`@trigger` in the compiled report), else the scene's `<SceneName>OnLoad`,
else its `main` storyline — once, guarded by the `__played_main_<map>` flag.
Talking to an NPC (face + A) runs the storyline named by its `talk` field,
else a route naming that NPC, else the map scene's `main`, else shows `talk`
as raw text. A map's scene is the compiled scene whose source is
`<mapsDir>/<map>/script.scene`, falling back to a scene named like the map.

### Commands

The scene VM fully supports `showText` (paged textbox),
`showChoice` (menu → index), `warpTo`, `delay`, `fadeScreen`, flags
(`setFlag`/`resetFlag`/`checkFlag`, persisted across scenes for the session),
`startBattle`/`startWildBattle` (see [the battle rules](battle-rules.md)) and `openShop`
(see [Shops](#shops)). Any other command logs a warning and auto-completes
rather than deadlocking the scene.

### Menus

Pressing **Start** in the overworld opens a pause menu (B/Start
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

### Shops

The runner owns the
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

### Game-over

Losing a battle no longer strands the player with a 0-HP
party: after the scene that received `"lose"` finishes (its own post-lose
text plays first), the runner runs a **whiteout** — a brief blackout, a
`<Name> collapsed…` line, then the whole party is healed to full HP/MP
(status cleared) and the player returns to the **entry map's spawn point**
(the current map if it is the entry map, otherwise the entry map loads).
Flags, inventory and money are kept. Map-less (dialogue-only) projects just
heal. There is no heal-point system yet: the respawn is always the entry
spawn.

### Audio

`playMusic`/`playSound`/`stopMusic`/`fadeOutMusic` play tracks
from `data/audio/**/*.json` (dotzuki-audio `TrackDef` format; `music/` + `sfx/`
subdirs are a convention — the tree is loaded recursively). The id a scene
passes is the track's `id` field; unknown ids warn once and continue. Audio
is fully optional: no `data/audio/` dir means every command is a silent
no-op with zero device cost, the output device is opened lazily on the first
play command, and a missing/unavailable device (CI, `--headless`) logs once
and continues silent. Audio files are not hot-reloaded by `--watch` (they
load at boot).

### Sprites

The player uses `gfx/overworld/player/sheet.png` (24×32 cells,
4 facings × 5 frames) when present; otherwise a procedural placeholder person
is drawn. NPCs always render as id-colored placeholders in this version.

### Save/load

The game saves to `<project>/.dotzuki-save.json` (override with
`--save-file`) — versioned JSON: `{version, map, player: {x, y, facing, level?},
flags, lang, party?, inventory?, money?}` (v3; `party`/`inventory` appear
once a battle has completed — see [the battle rules](battle-rules.md); party members may
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

The compatibility rules around this format live in
[Save compatibility](../explanation/save-compatibility.md).

### Hot reload

With `--watch` (windowed mode only), the running game watches
the data/gfx/scene directories: a `.scene` edit recompiles the DSL and swaps
scenes in place (a broken edit keeps the old scenes running; diagnostics are
logged), and an edit to the *current* map's `map.tmx.json` / `tileset.png` /
objects sidecar reloads that map in place, preserving the player position and
flags. Other maps, data tables and gfx are picked up on next enter / boot.

### Not yet implemented

Scenes relying on these warn and continue: the
`StackDriver` turn loop.

## What `dotzuki check` compiles

`dotzuki check <dir>` loads the manifest, collects every directory that may hold
DSL files, and runs `dotzuki_engine_dsl::compiler::compile_dirs` over them (in
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
present on disk) must parse as a dotzuki-rules `Ruleset` AND compile against
the closed vocabulary — an unknown event, op, or stat/type/resource/status
name in a hook is a diagnostic, exactly as it would be a boot-time error at
battle start.
Battle diagnostics print and fail the exit code like DSL diagnostics.
Record JSONs are not loaded — the manifest's table definitions suffice.

## Editor playtest (WASM runner)

The editor's `play` activity runs the same `RunnerGame` **in the browser** via
`crates/dotzuki-runner-web` (wasm-bindgen), so playtesting needs no Rust
toolchain. The contract with the runner:

- **Bundle.** `GET /api/play/bundle` returns the whole project as
  `{ files: { "<project-relative posix path>": "<base64>" }, projectRoot }`,
  excluding `node_modules`/`.git`/`target`/`dist`, `*.bak` and dotfiles other
  than `.dotzuki-editor.json` (16 MB/file, 64 MB total caps). Paths keep the
  `data/maps/<id>/script.scene` shape the runner's scene↔map matching expects.
- **Boot.** The bundle feeds `vfs::MemoryFiles` and
  `LoadedProject::load_with_files` — the exact boot path of `dotzuki run`,
  minus the disk. `RunnerOptions` force `watch=false`, headless (no audio
  device), `pcm_audio=true` and no disk saves.
- **Frames.** The page calls `tick(input_bitmask)` at ~59.7 Hz and blits the
  returned 320×240 RGBA frame. Input bitmask matches `GbButton` bit order
  (bit0=A … bit7=Down).
- **Audio.** Instead of a cpal device, the runner renders APU PCM per tick
  (`RunnerGame::render_audio`, 44.1 kHz stereo f32); the page drains it via
  `take_audio()` into a WebAudio queue (`usePlayAudio`). Same sequencer/fade
  path as native, just a pull model instead of the callback thread.
- **Saves.** `export_save()`/`import_save(json)` replace `.dotzuki-save.json`;
  the editor persists them to `localStorage`. `export_save` returns nothing
  while a scene/battle/shop/warp transition is suspended — the editor simply
  retries on its interval.

Differences from native `dotzuki run`: no file watching (the
editor's **Restart** button re-fetches the bundle and reboots, restoring the
save), audio output goes through the browser's `AudioContext` instead of a
cpal device, and battle RNG is seeded without wall-clock time. Everything
else — maps, dialogue, choices, battles, shops, menus, game-over flow — is
the same code.
