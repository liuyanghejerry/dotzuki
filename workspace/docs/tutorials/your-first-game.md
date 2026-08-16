# Your First Game — Town, Battle, Story and Save

> - **Audience**: game authors
> - **Type**: tutorial
> - **Status**: active
> - **Last verified**: v0.1.1

Build the project committed at
[`examples/your-first-game/`](../../examples/your-first-game/) step by step: a town with an
NPC guide, a scripted battle, a clearing whose tall grass rolls random encounters, and a
save — authored entirely as data, with no Rust.

Before you start, finish [the quickstart](quickstart.md) and put a `dotzuki` binary on
your PATH. Build it once from `workspace/`:

```bash
cd workspace
cargo build --release --bin dotzuki
```

The binary lands at `target/release/dotzuki`.

Shortcut: `dotzuki new <name> --template your-first-game` writes the finished
project (the same files you will build below) — the tutorial stays the
step-by-step route.

The goal is the committed project itself: a playable town, a scripted battle, a
random-encounter clearing, and a save. Every listing below is a copy of that project,
so every step ends in a state the next one continues from. The two `map.tmx.json`
listings abbreviate their tile arrays with a marked `<!-- excerpt -->` comment; copy
those arrays from the committed project.

## 1. Scaffold the project

```bash
dotzuki new your-first-game
cd your-first-game
```

`dotzuki new` [scaffolds](../reference/glossary.md) a
[zero-Rust project](../reference/glossary.md) — a plain directory the engine and the
editor consume as-is. The layout it writes:

- `.dotzuki-editor.json` — the [manifest](../reference/glossary.md): seven editor
  activities, an empty data-`tables` list, and a `game` section.
- `data/maps/` — one directory per map; empty for now.
- `data/tiles/` — the shared tile library; this game does not use it, leave it empty.
- `data/stories/` — the story-bible skeleton; this game does not use it, leave it
  empty.
- `gfx/` — graphics assets.
- `assets/scenes/main.scene` — a starter [scene](../reference/glossary.md) written in
  the [Game DSL](../reference/glossary.md); step 6 replaces it.
- `README.md` — free-form notes.

## 2. The manifest

Replace the scaffolded `.dotzuki-editor.json` with this file:

```json
{
  "name": "Your First Game",
  "dataRoot": "./data",
  "gfxRoot": "./gfx",
  "activities": [
    {
      "id": "maps",
      "type": "map",
      "label": "Maps",
      "icon": "map",
      "enabled": true,
      "config": {
        "mapsDir": "maps"
      }
    },
    {
      "id": "scripts",
      "type": "script",
      "label": "Scripts",
      "icon": "code",
      "enabled": true,
      "config": {
        "extension": ".scene",
        "scriptsDir": "maps"
      }
    },
    {
      "id": "play",
      "type": "play",
      "label": "Play",
      "icon": "play",
      "enabled": true,
      "config": {}
    },
    {
      "id": "data",
      "type": "data",
      "label": "Data",
      "icon": "database",
      "enabled": true,
      "config": {
        "tables": [
          {
            "id": "heroes",
            "label": "Heroes",
            "dir": "heroes",
            "icon": "user",
            "idField": "id",
            "fields": [
              { "id": "name", "label": "Name", "type": "string" },
              { "id": "hp", "label": "HP", "type": "number" },
              { "id": "atk", "label": "Attack", "type": "number" },
              { "id": "def", "label": "Defense", "type": "number" },
              { "id": "spd", "label": "Speed", "type": "number" },
              { "id": "mp", "label": "MP", "type": "number" },
              { "id": "element", "label": "Element", "type": "string" },
              { "id": "skills", "label": "Skills", "type": "list" }
            ]
          },
          {
            "id": "monsters",
            "label": "Monsters",
            "dir": "monsters",
            "icon": "bug",
            "idField": "id",
            "fields": [
              { "id": "name", "label": "Name", "type": "string" },
              { "id": "hp", "label": "HP", "type": "number" },
              { "id": "atk", "label": "Attack", "type": "number" },
              { "id": "def", "label": "Defense", "type": "number" },
              { "id": "spd", "label": "Speed", "type": "number" },
              { "id": "mp", "label": "MP", "type": "number" },
              { "id": "element", "label": "Element", "type": "string" },
              { "id": "skills", "label": "Skills", "type": "list" }
            ]
          },
          {
            "id": "encounters",
            "label": "Encounters",
            "dir": "encounters",
            "icon": "crosshair",
            "idField": "id",
            "fields": [
              { "id": "name", "label": "Name", "type": "string" },
              { "id": "enemies", "label": "Enemies", "type": "list" },
              { "id": "trainer", "label": "Trainer", "type": "boolean" },
              { "id": "money", "label": "Money", "type": "number" }
            ]
          },
          {
            "id": "spells",
            "label": "Spells",
            "dir": "spells",
            "icon": "sparkles",
            "idField": "id",
            "fields": [
              { "id": "name", "label": "Name", "type": "string" },
              { "id": "type", "label": "Category", "type": "string" },
              { "id": "power", "label": "Power", "type": "number" },
              { "id": "accuracy", "label": "Accuracy", "type": "number" },
              { "id": "element", "label": "Element", "type": "string" },
              { "id": "stat", "label": "Stat", "type": "string" },
              { "id": "mpCost", "label": "MP Cost", "type": "number" }
            ]
          },
          {
            "id": "items",
            "label": "Items",
            "dir": "items",
            "icon": "package",
            "idField": "id",
            "fields": [
              { "id": "name", "label": "Name", "type": "string" },
              { "id": "healHp", "label": "Heal HP", "type": "number" },
              { "id": "price", "label": "Price", "type": "number" },
              { "id": "effect", "label": "Effect", "type": "string" }
            ]
          }
        ]
      }
    },
    {
      "id": "story",
      "type": "story",
      "label": "Story",
      "icon": "book",
      "enabled": true,
      "config": {
        "locales": [
          "en",
          "zh"
        ],
        "scenesDir": "maps",
        "storiesDir": "stories"
      }
    },
    {
      "id": "assets",
      "type": "assets",
      "label": "Assets",
      "icon": "image",
      "enabled": true,
      "config": {
        "roots": [
          "gfx"
        ]
      }
    },
    {
      "id": "tiles",
      "type": "tiles",
      "label": "Tiles",
      "icon": "tiles",
      "enabled": true,
      "config": {
        "backdropMapsDir": "maps",
        "tileSize": 16,
        "tilesDir": "tiles"
      }
    }
  ],
  "game": {
    "entryScene": "main",
    "entryMap": "Hometown",
    "scenesDir": "assets/scenes"
  },
  "battle": {
    "party": { "table": "heroes" },
    "enemies": { "table": "monsters" },
    "encounters": { "table": "encounters" },
    "skills": { "table": "spells", "field": "skills", "categoryField": "type", "costField": "mpCost" },
    "stats": { "hp": "hp", "attack": "atk", "defense": "def", "speed": "spd" },
    "resource": "mp",
    "rules": "data/rules.ron",
    "items": { "table": "items", "healField": "healHp", "starting": { "potion": 3 } }
  },
  "shop": { "currency": "G", "startMoney": 100 }
}
```

Five top-level sections matter here:

- `activities` — the seven editor [activities](../reference/glossary.md) (Maps,
  Scripts, Play, Data, Story, Assets, Tiles). `maps` points the map activity at `maps`
  under `dataRoot`; `scripts` points the script activity at the same `maps` directory
  with extension `.scene`, so per-map scene files sit next to their maps. The `data`
  activity declares the five [data tables](../reference/glossary.md): each `tables[]`
  entry names a `dir`, an `idField`, and the field schema the editor renders as a form.
  `story` declares the bilingual locales and points `scenesDir` at `maps`; `assets`
  roots the asset picker at `gfx`; `tiles` configures the tile-library pane.
- `game` — the engine-facing section. `entryScene: "main"` names the scene under
  `scenesDir` used when the project has no maps; `entryMap: "Hometown"` is the
  [entry map](../reference/glossary.md) `dotzuki run` spawns on;
  `scenesDir: "assets/scenes"` is the scene directory.
- `battle` — arms the data-driven battle system. `party` and `enemies` name the
  combatant tables (`heroes` vs `monsters`); `encounters` names the encounter table;
  `skills` names the `spells` table and the field names — `field: "skills"` is the
  skill list on a combatant record, `categoryField: "type"` and `costField: "mpCost"`
  name the category and MP-cost columns; `stats` maps the four roles (`hp`, `attack`,
  `defense`, `speed`) to record fields; `resource: "mp"` names the MP pool field;
  `rules: "data/rules.ron"` points at the rules file (step 4); `items` names the items
  table, its `healField: "healHp"`, and a starting inventory of 3 potions.
- `shop` — `currency: "G"` and `startMoney: 100`: the money the runner owns, shows in
  the Bag and the shop UI, and carries in the save.

## 3. Data tables

Each table directory holds one JSON record per row, named `<id>.json` under
`data/<dir>/`. Create these nine files.

### Heroes

`data/heroes/aria.json` — the [party](../reference/glossary.md) is every record of the
`heroes` table, so Aria leads alone:

```json
{
  "id": "aria",
  "name": "Aria",
  "hp": 60,
  "atk": 12,
  "def": 10,
  "spd": 15,
  "mp": 20,
  "element": "grass",
  "skills": ["slash", "fire-bolt", "bubble", "heal"]
}
```

The four [stats](../reference/glossary.md) (`hp`, `atk`, `def`, `spd`) map through
`battle.stats`. `mp` is the pool `battle.resource` names — Fire Bolt and Heal draw from
it. `element: "grass"` is Aria's [element](../reference/glossary.md), the defending
side of [type chart](../reference/glossary.md) lookups. `skills` lists the
[skill](../reference/glossary.md) ids from the `spells` table that Aria can use in
battle.

### Monsters

`data/monsters/slime.json` and `data/monsters/goblin.json` — the enemy records, same
fields as heroes:

```json
{
  "id": "slime",
  "name": "Slime",
  "hp": 40,
  "atk": 8,
  "def": 8,
  "spd": 5,
  "mp": 0,
  "element": "grass",
  "skills": ["slash"]
}
```

```json
{
  "id": "goblin",
  "name": "Goblin",
  "hp": 55,
  "atk": 10,
  "def": 9,
  "spd": 9,
  "mp": 0,
  "element": "fire",
  "skills": ["slash"]
}
```

The Slime is grass, the Goblin fire — the chart rows from step 4 make Fire Bolt hit the
Slime ×2 and Bubble hit the Goblin ×2. Both know only Slash, and `mp: 0` means no MP
pool, which their only skill does not need.

### Encounters

`data/encounters/rival.json` — an [encounter](../reference/glossary.md) record:

```json
{
  "id": "rival",
  "name": "Rival Kai",
  "enemies": ["goblin"],
  "trainer": true,
  "money": 50
}
```

`enemies` is the ordered queue the enemy side sends out; `trainer: true` makes it a
[trainer battle](../reference/glossary.md) — Run is blocked and a win pays
`money: 50` G. No scene in this game calls `rival`; the record demonstrates the schema
and stays ready for a later storyline. The Guide's battle starts the wild `slime`
record instead (step 6).

### Spells

`data/spells/fire-bolt.json`, `data/spells/slash.json`, `data/spells/bubble.json`,
`data/spells/heal.json`:

```json
{
  "id": "fire-bolt",
  "name": "Fire Bolt",
  "type": "attack",
  "power": 50,
  "accuracy": 100,
  "element": "fire",
  "mpCost": 5
}
```

```json
{
  "id": "slash",
  "name": "Slash",
  "type": "attack",
  "power": 40,
  "accuracy": 100,
  "mpCost": 0
}
```

```json
{
  "id": "bubble",
  "name": "Bubble",
  "type": "attack",
  "power": 40,
  "accuracy": 100,
  "element": "water",
  "mpCost": 4
}
```

```json
{
  "id": "heal",
  "name": "Heal",
  "type": "heal",
  "power": 25,
  "accuracy": 100,
  "mpCost": 4
}
```

`type` is the category column (`battle.skills.categoryField`): `attack` deals damage
through the standard formula, `heal` restores the user's own HP by `power`, capped at
max. `element` feeds the chart — Fire Bolt is fire, Bubble water; Slash and Heal carry
none, so no row applies to them. `mpCost` is the cost column
(`battle.skills.costField`): Fire Bolt costs 5 MP, Heal 4, Slash 0. `accuracy: 100`
always lands. The formula and the turn loop live in
[the battle rules reference](../reference/battle-rules.md).

### Items

`data/items/potion.json`:

```json
{
  "id": "potion",
  "name": "Potion",
  "healHp": 20,
  "price": 20,
  "effect": "Restores 20 HP."
}
```

`healHp: 20` is the `battle.items.healField` — a positive number makes the item usable
in battle and from the pause-menu Bag, restoring 20 HP per use, capped at max.
`price: 20` is the shop's Buy price. `effect` is display-only flavor text.

## 4. The rules file

`data/rules.ron` — the declarative battle rules, parsed by `dotzuki-rules`:

```ron
// rules.ron — Your First Game's battle ruleset. The runner consumes the
// type chart only; stats/types/resources are declared so the file is a
// valid dotzuki-rules Ruleset (see reference/battle-rules.md).
Ruleset(
    stats: ["hp", "atk", "def", "spd"],
    types: ["fire", "grass", "water"],
    resources: ["mp"],
    type_chart: [
        (atk: "fire", def: "grass", mult: [2, 1]),
        (atk: "grass", def: "fire", mult: [1, 2]),
        (atk: "water", def: "fire", mult: [2, 1]),
    ],
)
```

The [runner](../reference/glossary.md) loads this [RON](../reference/glossary.md) file
from the path `battle.rules` names and reads the `type_chart`: each row pairs an
attacking skill's `element` with a defender's `element`, and `mult: [num, den]` is the
rational multiplier — `[2, 1]` scales the hit ×2 (super effective), `[1, 2]` scales it
×½ (resisted). A pairing absent from the chart stays ×1. Fire Bolt vs the grass Slime
lands ×2, Bubble vs the fire Goblin lands ×2, and a grass skill against a fire target
lands ×½.

`stats`, `types` and `resources` declare the closed vocabulary so the file parses as a
valid dotzuki-rules `Ruleset` — `dotzuki check` fails on an unknown name. This game
declares no `effects`, so the chart is the live part; a rules file with `effects`
compiles into runtime [effect stacks](../reference/glossary.md) (see
[the battle rules reference](../reference/battle-rules.md)).

## 5. The town map

Create `data/maps/Hometown/` with three files: `map.tmx.json`, `tileset.png`, and
`objects.json`.

`map.tmx.json` is Tiled JSON: 20 × 15 [tiles](../reference/glossary.md) of 8 × 8 px.
The `ground` and `decoration` layers render; the `collision` layer never renders and
blocks every tile whose GID is non-zero. [GIDs](../reference/glossary.md) are 1-based
into the [tileset](../reference/glossary.md) atlas, which the `tilesets` block names —
`tileset.png`, 32 × 8 px, four tiles, `columns: 4`.

```json
{
  "width": 20,
  "height": 15,
  "tilewidth": 8,
  "tileheight": 8,
  "backgroundcolor": "#306850",
  "layers": [
    {
      "name": "ground",
      "width": 20,
      "height": 15,
      <!-- excerpt: `data` is 300 GIDs (20 rows × 20). GID 1 fills the map, GID 4
           marks the path column (x=10) and the cross row (y=7). The full array
           lives in examples/your-first-game/data/maps/Hometown/map.tmx.json. -->
      "data": [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 4, 1, 1, 1, 1, 1, 1, 1, 1, 1, ...],
      "visible": true,
      "opacity": 1.0
    },
    {
      "name": "decoration",
      "width": 20,
      "height": 15,
      <!-- excerpt: `data` is 300 GIDs (20 rows × 20). Mostly 0; GID 2 trees dot
           the field. The full array lives in
           examples/your-first-game/data/maps/Hometown/map.tmx.json. -->
      "data": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, ...],
      "visible": true,
      "opacity": 1.0
    },
    {
      "name": "collision",
      "width": 20,
      "height": 15,
      <!-- excerpt: `data` is 300 GIDs (20 rows × 20). A GID-1 ring borders the
           map; 0 inside, so the warp tile (18, 7) stays walkable. The full
           array lives in examples/your-first-game/data/maps/Hometown/map.tmx.json. -->
      "data": [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, ...],
      "visible": false,
      "opacity": 1.0
    }
  ],
  "tilesets": [
    {
      "firstgid": 1,
      "name": "demo",
      "tilewidth": 8,
      "tileheight": 8,
      "tilecount": 4,
      "image": "tileset.png",
      "imagewidth": 32,
      "imageheight": 8,
      "columns": 4
    }
  ]
}
```

The `data` arrays hold 300 entries each (20 rows × 20); each listing shows a
representative row with an `<!-- excerpt -->` marker. Copy the full arrays from
`examples/your-first-game/data/maps/Hometown/map.tmx.json`.
`ground` paints GID 1 everywhere with a GID-4 path column (x=10) and a full GID-4 cross
row (y=7); `decoration` drops GID-2 trees; `collision` rings the border with GID 1,
leaving the interior — and the warp tile (18, 7) — walkable.

Copy the atlas into place (both maps share it):

```bash
cp <repo>/workspace/dotzuki-template/assets/tileset.png data/maps/Hometown/tileset.png
```

Replace `<repo>` with the path to this repository.

`objects.json` is the map's [sidecar](../reference/glossary.md) — the
[entities](../reference/glossary.md) placed on the map:

```json
{
  "npcs": [
    {
      "id": 1,
      "name": "Guide",
      "x": 12,
      "y": 7,
      "facing": "down",
      "talk": "guide_talk"
    }
  ],
  "warps": [
    { "x": 18, "y": 7, "dest_map": "Clearing", "dest_x": 2, "dest_y": 5 }
  ],
  "signs": [
    { "x": 3, "y": 3, "text": "Hometown — every journey starts here." }
  ]
}
```

The Guide NPC stands at (12, 7) facing down; its `talk` field names the storyline that
runs when the player faces it and presses A. The [warp](../reference/glossary.md) at
(18, 7) fades the player to the `Clearing` map, arriving at tile (2, 5). The sign at
(3, 3) shows its text as paged dialogue when the player faces it and presses A.

## 6. Scenes

Replace `assets/scenes/main.scene`, then create `data/maps/Hometown/script.scene`.

A [scene](../reference/glossary.md) is one `game_scene` document of
[storylines](../reference/glossary.md). `main.scene` holds the unnamed `@storylines`
block — the `main` storyline:

```dsl
game_scene Main {
    @storylines {
        @speaker("Guide") {
            "Welcome to Your First Game!"
            "Talk to the Guide in Hometown, then find the warp to the Clearing."
        }
    }
}
```

The manifest's `game.entryScene: "main"` names this file for map-less runs. With maps
present, `game.entryMap` wins: `dotzuki run` spawns on Hometown and the map's own scene
drives it, so `main.scene` keeps the `scenesDir` contract intact.

`script.scene` sits next to the map, and that placement is the binding: the runner
resolves a map's scene as `<mapsDir>/<map>/script.scene`. Hometown's scene has two
named storylines:

```dsl
game_scene Hometown {
    @storyline("hometown_intro") {
        @trigger(map = "Hometown", on_enter = true)
        @speaker("Guide") {
            "Welcome to Hometown, Aria!"
            "The warp on the east edge leads to the Clearing."
            "Wild monsters roam the tall grass there — a good place to train."
        }
    }

    @storyline("guide_talk") {
        @trigger(map = "Hometown", npc = "Guide")
        @speaker("Guide") {
            "You look ready for your first fight."
            "Want to try one right here?"
        }
        @choice {
            @option("Let's fight!") {
                result = startBattle("slime")
                @if (result == "win") {
                    @speaker("Guide") {
                        "Well fought! Fire beats grass, remember that."
                    }
                    @command("setFlag", "WON_GUIDE_BATTLE")
                } @else {
                    @speaker("Guide") {
                        "It happens. Heal up and try again."
                    }
                }
            }
            @option("Not yet.") {
                @speaker("Guide") {
                    "Come back when you are ready."
                }
            }
        }
    }
}
```

- `hometown_intro` carries a [trigger](../reference/glossary.md) with
  `on_enter = true` — the runner fires it when the map loads.
- `guide_talk` carries `npc = "Guide"`, the route that names this NPC — and the NPC's
  `talk` field names the same storyline; talking to the Guide runs it.
- `@choice` presents the two `@option`s as a menu.
- `result = startBattle("slime")` suspends the scene and starts a
  [wild battle](../reference/glossary.md) against the `slime` record; the scene
  resumes with `result` set to `"win"`, `"lose"` or `"run"`.
- `@if (result == "win")` branches on the outcome; the win branch sets the
  [flag](../reference/glossary.md) `WON_GUIDE_BATTLE` with a
  [command](../reference/glossary.md). Flags persist across scenes for the session
  and ride the save.

## 7. The clearing

Create `data/maps/Clearing/` the same way — a smaller 12 × 10 map:

```json
{
  "width": 12,
  "height": 10,
  "tilewidth": 8,
  "tileheight": 8,
  "backgroundcolor": "#306850",
  "layers": [
    {
      "name": "ground",
      "width": 12,
      "height": 10,
      <!-- excerpt: `data` is 120 GIDs (10 rows × 12). GID 1 fills the map, GID 4
           marks the tall-grass patch (x=5–6, y=2–7). The full array lives in
           examples/your-first-game/data/maps/Clearing/map.tmx.json. -->
      "data": [1, 1, 1, 1, 1, 4, 4, 1, 1, 1, 1, 1, ...],
      "visible": true,
      "opacity": 1.0
    },
    {
      "name": "collision",
      "width": 12,
      "height": 10,
      <!-- excerpt: `data` is 120 GIDs (10 rows × 12). A GID-1 border rings the
           map; the west wall opens at (0, 4) so the return warp tile stays
           walkable. The full array lives in
           examples/your-first-game/data/maps/Clearing/map.tmx.json. -->
      "data": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, ...],
      "visible": false,
      "opacity": 1.0
    }
  ],
  "tilesets": [
    {
      "firstgid": 1,
      "name": "demo",
      "tilewidth": 8,
      "tileheight": 8,
      "tilecount": 4,
      "image": "tileset.png",
      "imagewidth": 32,
      "imageheight": 8,
      "columns": 4
    }
  ]
}
```

`ground` paints GID 1 with a GID-4 tall-grass patch at (x=5–6, y=2–7); `collision`
borders the map and opens the west wall at (0, 4) so the return warp tile stays
walkable. Copy the full arrays from
`examples/your-first-game/data/maps/Clearing/map.tmx.json`.

```bash
cp <repo>/workspace/dotzuki-template/assets/tileset.png data/maps/Clearing/tileset.png
```

`objects.json` adds the `encounters` block — the map's encounter side:

```json
{
  "warps": [
    { "x": 0, "y": 4, "dest_map": "Hometown", "dest_x": 17, "dest_y": 7 }
  ],
  "encounters": {
    "rate": 60,
    "zones": [
      {
        "x": 1,
        "y": 1,
        "w": 10,
        "h": 8,
        "table": [
          { "id": "slime", "weight": 60 },
          { "id": "goblin", "weight": 40 }
        ]
      }
    ]
  }
}
```

`rate: 60` is the per-step chance in /256 units: a completed walk step onto a zoned
tile draws one byte, and a value below 60 (≈ 23%) triggers a battle. Each `zones`
rectangle (`x`, `y`, `w`, `h`) is an inclusive tile range; a hit draws a weighted id
from the zone's `table` — Slime 60, Goblin 40. The id resolves like `startBattle(id)`
and arms a [sceneless battle](../reference/glossary.md): a win or a run returns to the
overworld at the encounter tile; a loss runs the
[whiteout](../reference/glossary.md) — the party heals and the player respawns at the
[entry map](../reference/glossary.md)'s [spawn](../reference/glossary.md). The return
warp at (0, 4) lands on Hometown (17, 7), one tile west of the east-edge warp.

The scene announces the place with the [narrator form](../reference/glossary.md) —
`@speaker("")` renders the line without a name prefix:

```dsl
game_scene Clearing {
    @storyline("clearing_enter") {
        @trigger(map = "Clearing", on_enter = true)
        @speaker("") {
            "Tall grass rustles all around. Wild monsters prowl here."
        }
    }
}
```

## 8. Run it

Compile-check every DSL directory and validate the battle section:

```bash
dotzuki check .
```

Exit code 0 means the scenes compile and the battle wiring — the table ids, the field
names, and `data/rules.ron` — validates.

Play it in a window:

```bash
dotzuki run .
```

Controls: **Arrows/WASD** move, **Z** confirms and talks, **X** cancels and runs,
**Enter/Space** opens the pause menu, **Backspace** is Select. The tour: read the sign,
talk to the Guide and pick **Let's fight!** — Aria battles the wild Slime, Fire Bolt
hits ×2 (fire beats grass), and the win sets `WON_GUIDE_BATTLE`. Step onto the
east-edge warp to the Clearing; the tall-grass zone rolls encounters as you walk; take
the west-edge warp home. The pause menu holds **Party**, **Bag** and **Save**.

CI and screenshots run the same game [headless](../reference/glossary.md) — no window:

```bash
dotzuki run . --headless --frames 180
```

`--frames 180` simulates 180 frames — the [smoke test](../reference/glossary.md) this
repo's CI runs. Headless runs never write a save unless you pass `--save`;
`--screenshot shot.png` dumps the final frame:

```bash
dotzuki run . --headless --frames 180 --save --screenshot shot.png
```

`--lang zh` switches the runner's own labels (the pause menu, the save confirmation)
to Chinese; scene text follows when written with
[`@t("en", "中文")`](../reference/glossary.md).

The save lands at `.dotzuki-save.json` in the project dir —
[save version](../reference/glossary.md) 3, holding the map, the player tile and
facing, the flags, the party state, the inventory and the money. Saves write at stable
points — after a warp transition and when a scene finishes into the
[overworld](../reference/glossary.md) — so closing the window mid-dialogue keeps the
last stable point. Windowed runs always save; `--fresh` ignores an existing save and
boots new.

## Where next

- **Maps** — [how to author maps](../how-to/maps.md): elevation, entities, encounters,
  tilesets.
- **Battles** — [battle rules guide](../how-to/battles.md) and
  [battle rules reference](../reference/battle-rules.md): effects, abilities, held
  items, weather.
- **Manifest contract** — [project manifest](../reference/project-manifest.md): what
  `dotzuki run` and `dotzuki check` promise.
- **Editor path** — [editor-first-game.md](./editor-first-game.md): the same game
  through the dotzuki-editor and the AI Story Designer.
