# dotzuki — a generic JRPG game engine in Rust

[![Rust](https://img.shields.io/badge/Rust-1.70%2B-orange)](https://www.rust-lang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A game-agnostic JRPG engine extracted from a Pokémon Red/Blue reimplementation. This repository is **engine-only**: the games that drove the design (pokered, wuxia) live in their own repositories and consume the engine as Cargo **git dependencies** (tag-pinned).

## What this is

- **Generic engine crates** (`workspace/crates/`) — zero game data. Trait-driven (`GameData`), with:
  - `dotzuki-engine` — core traits, tilemap/camera/trigger systems, the battle **effect-stack** engine (`battle::stack`), generic item/shop/equip systems, link-play transport seam
  - `dotzuki-rules` + `dotzuki-rules-macro` — no-code battle authoring: `rules.ron` → runtime Effect stacks
  - `dotzuki-engine-tiled` — Tiled `.tmx` (JSON) maps → engine types
  - `dotzuki-engine-script` — Boa-based async JS scripting engine
  - `dotzuki-engine-dsl` — Game DSL compiler (`.scene` / `.gui` / `.theme` / `.style`, bilingual `@t` text) + runtime compile API (`compiler::compile_dirs`)
  - `dotzuki-renderer` — generic GB-style tile/sprite/text rendering, CJK pixel fonts, UI layout engine
  - `dotzuki-ui` — reusable JRPG UI widgets on a `Painter` trait
  - `dotzuki-audio` — audio abstraction layer
  - `dotzuki-app` — generic native app shell (window/loop/hot-reload)
  - `dotzuki-tui` — generic terminal shell (ratatui)
  - `dotzuki-web` / `dotzuki-runner-web` — WASM bridges for editor layout preview / playtest
  - `dotzuki-runner` — zero-Rust project runtime (`.dotzuki-editor.json` manifest + DSL + maps)
  - `dotzuki-cli` — the `dotzuki` binary: `dotzuki new` / `dotzuki check` / `dotzuki run`
- **Engine demo example** (`workspace/examples/`) — `minimon` (battle system authored entirely in RON rules). It is engine-only, proving the engine isn't game-locked.
- **Tools** (`workspace/tools/`) — `dotzuki-editor` (game-agnostic Vue/Vite editor + AI Story Designer + in-editor Play), `asset-converter`, DSL editor extensions.

## Using the engine from a game repo

```toml
[dependencies]
dotzuki-engine = { git = "<engine-repo-url>", tag = "v0.3.0" }
dotzuki-engine-dsl = { git = "<engine-repo-url>", tag = "v0.3.0" }
```

All `dotzuki-*` crates are resolvable from the same git repository (Cargo finds
them by name in the workspace). Upgrade = bump the tag + `cargo update`.
No crates.io publishing is planned at this stage.

## Building

The Cargo workspace root is `workspace/`:

```bash
cd workspace
cargo build          # or cargo build --release
cargo test           # engine + example tests
cargo run --release --bin dotzuki -- new demo && cd demo && cargo run --release --bin dotzuki -- run
```

## Layout

```
workspace/           # Cargo workspace root
├── crates/          # game-agnostic engine crates (see above)
├── examples/        # minimon (RON-rules-only battle demo)
├── tools/           # dotzuki-editor (Vue/Vite), asset-converter, editor-extensions
├── docs/            # engine docs (battle engine, DSL specs, game-project spec)
└── dotzuki-template/  # cargo-generate starter for new games
docs/                # repo-level docs (split record, marketing notes)
AGENTS.md            # developer guide for AI agents
```

## Documentation

- **[`workspace/docs/README.md`](workspace/docs/README.md) — documentation index**
  (reader guide + status of every engine doc). Start here.
- Quickstart (zero-Rust, 5 minutes): [`workspace/docs/QUICKSTART.md`](workspace/docs/QUICKSTART.md)
- CLI reference (`dotzuki new` / `check` / `run`): [`workspace/docs/CLI_REFERENCE.md`](workspace/docs/CLI_REFERENCE.md)
- Game project spec (zero-Rust `.dotzuki-editor.json` projects): [`workspace/docs/game-project-spec.md`](workspace/docs/game-project-spec.md)
- Battle engine guide (effect-stack + `rules.ron`): [`workspace/docs/BATTLE_ENGINE_GUIDE.md`](workspace/docs/BATTLE_ENGINE_GUIDE.md) / [`.zh-CN.md`](workspace/docs/BATTLE_ENGINE_GUIDE.zh-CN.md)
- DSL docs: [`workspace/docs/GAME_UI_DSL.md`](workspace/docs/GAME_UI_DSL.md), [`workspace/docs/DSL_MAPPING.md`](workspace/docs/DSL_MAPPING.md)
- Editor guide: [`workspace/tools/dotzuki-editor/README.md`](workspace/tools/dotzuki-editor/README.md) + [quickstart](workspace/tools/dotzuki-editor/docs/first-game.md)

See `AGENTS.md` for the full developer guide.
