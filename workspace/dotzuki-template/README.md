# JRPG Template

A `cargo-generate` template for creating JRPG games using the `dotzuki-engine` workspace.

## Prerequisites

- **Rust** 1.70+ ([rustup](https://rustup.rs))
- **Platform libraries** for `pixels`/`winit` (see below)

### macOS
```bash
xcode-select --install
```

### Linux (Ubuntu/Debian)
```bash
sudo apt install build-essential pkg-config libxkbcommon-dev libwayland-dev \
  libx11-dev libxrandr-dev libxi-dev libxcursor-dev libvulkan-dev libasound2-dev libudev-dev
```

### Windows
Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with "Desktop development with C++" workload.

## Quick Start

This template is the **Rust (hand-written `main.rs`) path**. The recommended
zero-Rust path is `dotzuki new my-game` + `dotzuki run` — see
[`game-project-spec.md`](../docs/game-project-spec.md). For the Rust path,
generate a project from this template:

```bash
cargo generate --path ./dotzuki-template --name my-jrpg
cd my-jrpg
cargo run --release
```

Or generate without `cargo-generate`:

```bash
cp -r dotzuki-template my-jrpg
cd my-jrpg
# Replace {{project-name}} in Cargo.toml with my-jrpg
cargo run --release
```

## Controls (template's minimal `main.rs` mapping)

| Key | Action |
|-----|--------|
| Arrow keys | Move player (one tile at a time) |
| Space | Trigger DSL dialogue scene |
| Escape | Quit |

> This is the template's own minimal input mapping. The zero-Rust `dotzuki run`
> path uses engine-standard keys instead (Arrows/WASD move, `Z` = A, `X` = B,
> `Enter`/`Space` = Start menu, `Backspace` = Select) — see
> [`game-project-spec.md`](../docs/game-project-spec.md).

## Project Structure

```
my-jrpg/
├── Cargo.toml         # Depends on dotzuki-engine, dotzuki-engine-tiled, dotzuki-engine-script, dotzuki-engine-dsl
├── src/
│   └── main.rs        # Game loop: load map, render layers, handle input, camera follow
├── assets/
│   ├── demo.tmx       # 20×15 tile map (JSON Tiled format) with ground + decoration layers
│   ├── tileset.png    # 32×8 RGBA tileset: grass, tree, player, water
│   ├── script.js      # Entry map script (onEnter, onStep, onInteract)
│   ├── scenes/
│   │   ├── dialog.scene  # DSL dialogue scene (triggered by Space key)
│   │   └── shop.scene    # DSL shop scene with variables and choices
│   └── themes/
│       └── default.theme # DSL color theme definitions
└── README.md
```

## Creating Your Own Game

1. **Design your map** using [Tiled](https://www.mapeditor.org/) and export as JSON (.tmx)
2. **Create your tileset** as an RGBA PNG with 8×8 pixel tiles laid out horizontally
3. **Write map scripts** in JavaScript using the `onEnter()`, `onStep(x, y)`, `onInteract(facingX, facingY)` pattern
4. **Replace assets** in the `assets/` directory
5. **Customize main.rs**: adjust `tiled_gid_to_tileset_idx` to map your tile GIDs

## Creating Game Content with DSL

The template includes a **DSL (Domain-Specific Language)** workflow for authoring dialogue, choices, shop logic, and themes — all without writing Rust code.

### Scene Files (`.scene`)

Define interactive dialogues with branching choices, variables, and conditions:

```dsl
game_scene DialogDemo {
    @storylines {
        @speaker("NPC") {
            "Hello there!"
            "Welcome to the world of JRPG!"
        }
        @choice {
            @option("Who are you?") {
                @speaker("NPC") {
                    "I'm just a simple NPC."
                }
            }
            @option("Goodbye!") {
                @speaker("NPC") {
                    "Farewell, adventurer!"
                }
            }
        }
    }
}
```

### Theme Files (`.theme`)

Define color themes for your game's UI:

```dsl
@theme default {
    primary = "#c9a03d"
    background = "#1a1a2e"
    surface = "#16213e"
    text = "#eeeeee"
    text_muted = "#888888"
}
```

### How to Add New Scenes

1. Create a `.scene` file under `assets/scenes/`
2. Each scene needs a unique `game_scene Name { ... }` declaration
3. Add `@storylines` with `@speaker`, `@choice`, `@if` blocks
4. Add `@variables` for game state (gold, flags, counters)
5. Rebuild — the DSL compiler in `dotzuki-engine-dsl` compiles scenes to JavaScript at build time

### Workflow

```
1. Edit assets/scenes/dialog.scene    — write your dialogue
2. cargo run                           — scenes are compiled and loaded automatically
3. Press SPACE in-game                 — triggers the DialogDemo scene
```

The **Space** key calls `script_engine.call_function("storyline_main")` which executes the current scene's dialogue flow.

### Sample Files

| File | Description |
|------|-------------|
| `assets/scenes/dialog.scene` | Dialogue demo with NPC interaction |
| `assets/scenes/shop.scene` | Shop scene with gold, items, and choices |
| `assets/themes/default.theme` | Color theme definitions |

## Workspace Dependencies

This template depends on four workspace crates:

| Crate | Purpose |
|-------|---------|
| `dotzuki-engine` | Core types: Camera, Tilemap, MapLayer, MapRenderState, CollisionType |
| `dotzuki-engine-tiled` | Tiled .tmx JSON parser → dotzuki-engine types |
| `dotzuki-engine-script` | JavaScript scripting engine (Boa) for map event scripts |
| `dotzuki-engine-dsl` | DSL compiler — `.scene` / `.theme` → JavaScript + JSON |
