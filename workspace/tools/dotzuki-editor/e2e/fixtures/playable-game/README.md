# WASM Playtest

A JRPG project created with the JRPG Editor.

## Layout

- `.dotzuki-editor.json` — editor project config (activities, data roots)
- `data/maps/StartTown/` — demo town map (`map.tmx.json`, `tileset.png`, `script.scene`)
- `data/tiles/` — shared tile library (seeded with the starter tiles)
- `data/stories/` — narrative bible (characters, quests, arcs, `graph.json`)
- `data/<tables>/` — data tables (game templates include sample records)
- `gfx/` — graphics assets (sprites)
- `assets/scenes/` — Game DSL scene scripts (`.scene`)

## Editing

Reopen this folder from the editor's welcome screen (**Open Project**), or
start the editor with `JRPG_PROJECT_ROOT=<this folder>`. The in-editor AI
assistant (✨) can help sketch characters, quests and scenes.
