# jrpg-engine — a generic JRPG game engine in Rust

[![Rust](https://img.shields.io/badge/Rust-1.70%2B-orange)](https://www.rust-lang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A game-agnostic JRPG engine extracted from a Pokémon Red/Blue reimplementation. This repository is **engine-only**: the game that drove the design (pokered) and a second game (wuxia) live in their own repositories and consume the engine as Cargo **git dependencies** (`tag = "v0.1.0"`).

## What this is

- **Generic engine crates** (`crates/`) — zero game data. Trait-driven (`GameData`), with:
  - `jrpg-engine` — core traits, tilemap/camera/trigger systems, the battle **effect-stack** engine (`battle::stack`), generic item/shop/equip systems, link-play transport seam
  - `jrpg-rules` + `jrpg-rules-macro` — no-code battle authoring: `rules.ron` → runtime Effect stacks
  - `jrpg-engine-tiled` — Tiled `.tmx` (JSON) maps → engine types
  - `jrpg-engine-script` — Boa-based async JS scripting engine
  - `jrpg-engine-dsl` — Game DSL compiler (`.scene` / `.gui` / `.theme` / `.style`, bilingual `@t` text) + runtime compile API (`compiler::compile_dirs`)
  - `jrpg-renderer` — generic GB-style tile/sprite/text rendering, CJK pixel fonts, UI layout engine
  - `jrpg-ui` — reusable JRPG UI widgets on a `Painter` trait
  - `jrpg-audio` — audio abstraction layer
  - `jrpg-app` — generic native app shell (window/loop/hot-reload)
  - `jrpg-tui` — generic terminal shell (ratatui)
  - `jrpg-web` / `jrpg-runner-web` — WASM bridges for editor layout preview / playtest
  - `jrpg-runner` — zero-Rust project runtime (`jrpg-editor.json` manifest + DSL + maps)
  - `jrpg-cli` — the `jrpg` binary: `jrpg new` / `jrpg check` / `jrpg run`
- **Engine demo examples** (`examples/`) — `firered` (GBA-style 16-color rendering) and `minimon` (battle system authored entirely in RON rules). Both are engine-only, proving the engine isn't game-locked.
- **Tools** (`tools/`) — `jrpg-editor` (game-agnostic Vue/Vite editor + AI Story Designer + in-editor Play), `asset-converter`, DSL editor extensions.

## Using the engine from a game repo

```toml
[dependencies]
jrpg-engine = { git = "<engine-repo-url>", tag = "v0.1.0" }
jrpg-engine-dsl = { git = "<engine-repo-url>", tag = "v0.1.0" }
```

All `jrpg-*` crates are resolvable from the same git repository (Cargo finds
them by name in the workspace). Upgrade = bump the tag + `cargo update`.
No crates.io publishing is planned at this stage.

## Building

```bash
cd workspace
cargo build          # or cargo build --release
cargo test           # engine + examples tests
cargo run --release --bin jrpg -- new demo && cd demo && cargo run --release --bin jrpg -- run
```

## Layout

```
crates/              # game-agnostic engine (see above)
examples/firered/    # GBA-style 16-color rendering demo
examples/minimon/    # RON-rules-only battle demo
tools/jrpg-editor/   # Vue/Vite editor (pnpm install && pnpm dev)
jrpg-template/       # cargo-generate starter for new games
docs/                # engine docs (battle engine, DSL specs, game-project spec)
```

See `AGENTS.md` at the repo root for the full developer guide.
