# dotzuki — a generic JRPG game engine in Rust

[![Rust](https://img.shields.io/badge/Rust-1.70%2B-orange)](https://www.rust-lang.org/)
[![License: MIT OR Apache-2.0](https://img.shields.io/badge/License-MIT%20OR%20Apache--2.0-blue.svg)](#license)

A game-agnostic JRPG engine written from scratch in Rust — an original, independent implementation of classic JRPG mechanics (battles, overworld, events, menus, audio), not derived from any Nintendo game code. This repository is **engine-only**: the games that drove the design (pokered, wuxia) live in their own repositories and consume the engine as Cargo **git dependencies** (tag-pinned).

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

Prefer crates.io (all `dotzuki-*` crates are published there):

```toml
[dependencies]
dotzuki-engine = "0.1"
dotzuki-engine-dsl = "0.1"
```

Or pin a git tag (all crates are resolvable from the same repository — Cargo
finds them by name in the workspace):

```toml
[dependencies]
dotzuki-engine = { git = "https://github.com/liuyanghejerry/dotzuki", tag = "v0.5.0" }
dotzuki-engine-dsl = { git = "https://github.com/liuyanghejerry/dotzuki", tag = "v0.5.0" }
```

Upgrade = bump the version/tag + `cargo update`.

## Releasing

Every `dotzuki-*` crate shares one version (`[workspace.package] version` in
`workspace/Cargo.toml`). A `vX.Y.Z` tag (or a GitHub Release) triggers
`.github/workflows/release.yml`, which runs `workspace/scripts/publish-crates.sh`
— topological-order publish with an idempotent skip of already-published
versions. Requires the `CARGO_REGISTRY_TOKEN` Actions secret; see
`AGENTS.md` → "Releasing (crates.io)" for the full rules.

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
AGENTS.md            # developer guide for AI agents
```

See `AGENTS.md` for the full developer guide.

## License

Licensed under either of

- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE) or <http://www.apache.org/licenses/LICENSE-2.0>)
- MIT license ([LICENSE-MIT](LICENSE-MIT) or <http://opensource.org/licenses/MIT>)

at your option.

### Contribution

Unless you explicitly state otherwise, any contribution intentionally submitted
for inclusion in the work by you, as defined in the Apache-2.0 license, shall be
dual licensed as above, without any additional terms or conditions.
