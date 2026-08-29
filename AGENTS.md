# dotzuki-engine — Generic JRPG Engine (Rust)

## What This Is
A game-agnostic **Rust JRPG game engine**, written from scratch as an original, independent implementation of classic JRPG mechanics — not derived from any Nintendo game code. This repository is **engine-only** — the games that consume it (pokered, wuxia) live in separate repositories and depend on the engine crates via Cargo **git dependencies** (tag-pinned). The engine is *not* a Game Boy emulator and *not* byte-identical to any ROM; it reproduces game *logic* (battles, overworld, events, menus, audio) as portable, trait-driven Rust.

### Architecture: generic engine + games as consumers
```
crates/                          # Game-AGNOSTIC engine
├── dotzuki-engine/                 # Core engine — all trait definitions & generic types
│   │                            #   (GameData), tilemap/camera/triggers, the battle
│   │                            #   effect-stack engine (battle::stack), generic
│   │                            #   item/shop/equip systems, link transport seam
├── dotzuki-rules/                  # Declarative battle rules: RON → Effect stacks
├── dotzuki-rules-macro/            #   (derive/helpers for dotzuki-rules)
├── dotzuki-engine-tiled/           # Tiled .tmx (JSON) → engine types
├── dotzuki-engine-script/          # Boa-based async JS scripting engine
├── dotzuki-engine-dsl/             # Game DSL compiler (.scene/.gui/.theme/.style)
│   │                            #   + runtime compile API (compiler::compile_dirs)
│   │                            #   + disk scene providers w/ mtime hot reload (disk_loader)
├── dotzuki-cli/                    # `dotzuki` bin: scaffold (dotzuki new), compile-check
│   │                            #   (dotzuki check) & play (dotzuki run) zero-Rust projects
├── dotzuki-runner/                 # Zero-Rust project runtime: manifest model,
│   │                            #   project/DSL loading, maps/collision/tilesets,
│   │                            #   RunnerGame & headless driver
├── dotzuki-runner-web/             # WASM build of the runner (powers dotzuki-editor Play)
├── dotzuki-renderer/               # Generic GB-style tile/text renderer (CJK fonts)
├── dotzuki-ui/                     # Generic UI widgets on a Painter trait
├── dotzuki-audio/                  # Audio abstraction layer
├── dotzuki-app/                    # Generic native app shell (window/loop/hot-reload)
│   │                            #   + native link transports & session router (link)
│   │                            #   + generic TCP/JSON-line debug server (debug_server)
├── dotzuki-tui/                    # Generic terminal shell (ratatui)
└── dotzuki-web/                    # Generic WASM bridges: editor layout preview,
                                 #   pixels+winit game shell (`game-shell` feature),
                                 #   BroadcastChannel link transport (`link` feature)
examples/
└── minimon/                     # Cross-gen battle POC, pure RON rules
tools/dotzuki-editor/               # Game-agnostic Vue/Vite editor + AI Story Designer
                                 #   + in-editor Play activity (WASM dotzuki-runner)
                                 #   + Tailwind v4 UI theme via design tokens
                                 #     (src/design-tokens.css; see docs/DESIGN-TOKENS.md
                                 #     in that dir — components use semantic tokens,
                                 #     not raw palette classes)
tools/asset-converter/           # 2bpp → RGBA tileset + Tiled .tsx converter
tools/editor-extensions/         # VSCode DSL syntax highlighting
dotzuki-template/                   # cargo-generate starter template for new games
```

New game projects are **zero-Rust**: a `.dotzuki-editor.json` manifest plus a data/DSL/assets layout (see `workspace/docs/reference/project-manifest.md`), scaffolded by `dotzuki new` (dotzuki-cli) or the dotzuki-editor Create wizard.

## Build System (Rust)
- **Toolchain**: Rust 1.70+ (stable), wasm32-unknown-unknown target for WebAssembly
- **Build**: `cargo build` / `cargo build --release` from `workspace/`
- **Run**: `cargo run --release --bin dotzuki` (dotzuki-cli)
- **Tests**: `cargo test` (engine + demo examples)

## Workspace

The Cargo workspace root is **`workspace/`**, not the repo root. Run every `cargo` command from there:

```bash
cd workspace
cargo test
cargo build --release
```

## Key Conventions (Rust project)
- **Provider pattern**: Game data is provided via traits (no concrete game data in engine)
- **Generic associated types**: All identifier types (Map, Item, Species, etc.) are generic parameters on the `GameData` trait
- **Zero platform deps**: `dotzuki-engine` has no I/O, GPU, or platform calls
- **Battle = effect stack**: live battle turns run through `dotzuki_engine::battle::stack::StackDriver`
- **DSL for scripts/UI**: `.scene` files (Game DSL) compile to JS; `.gui` layouts compile to JSON; `@t("en","中文")` provides bilingual text. Games embed their own compiled scenes via `compiler::compile_dirs` / `loader::register_compiled` — the engine never probes a game's data directory. `dotzuki-engine-dsl` also ships a **native AST interpreter** (`interpreter.rs`) that executes `.scene` storylines with no JavaScript engine, mirroring the Boa runtime protocol 1:1; it is the canonical scene semantics for games that adopt it (Boa becomes a dev fallback via their `script-boa`-style feature)
- **Consumption by games**: games reference engine crates via crates.io deps or git deps (same repo, tag-pinned) — both are supported; see the "Releasing" section below. Keep every `dotzuki-*` crate resolvable from the workspace; never hardcode a game's paths back into the engine
- **Documentation system**: `workspace/docs/doc-standard.md` is the writing/structure standard (four-layer model, meta headers, language policy, banned words, example verification) and `workspace/docs/doc-outline.md` is the target site outline + migration map. Follow them when adding or editing docs; docs change in the same PR as the code they describe. A Clausura AI gate (`.github/workflows/docs-review.yml`, config `.clausura.yaml`, skill `.clausura/skills/docs-review/SKILL.md`) reviews every docs-touching PR against the standard — label `docs-ai-skip` to bypass; enabled only when the `CLAUSURA_API_KEY` repo secret is set.

## Releasing (crates.io)

All `dotzuki-*` crates are published to crates.io under one shared version — they inherit `[workspace.package] version` in `workspace/Cargo.toml`, so **one version bump releases every crate**.

- **Entry point**: `workspace/scripts/publish-crates.sh` — topological-order publish with a version-consistency gate and idempotent skip of already-published crates.
- **GitHub integration**: `.github/workflows/release.yml` runs it on `vX.Y.Z` tag pushes, GitHub Release publishes, and manual runs. The tag must name the workspace version (e.g. tag `v0.1.0` publishes every crate at 0.1.0). Requires the `CARGO_REGISTRY_TOKEN` repo secret (crates.io API token).
- **PR gate**: the `package-check` job in `.github/workflows/main.yml` runs `scripts/publish-crates.sh --check` — a manifest/packaging check. It stays strict except for the expected windows where an internal `dotzuki-*` dep is not yet resolvable on crates.io (pre-first-release, or right after a version bump while the sparse index catches up); those are reported as skipped, since the version-consistency gate already pins internal deps to the workspace version.
- **Local check**: `cd workspace && bash scripts/publish-crates.sh --check`.
- **Internal dep rule**: every internal `dotzuki-*` path dependency MUST carry `version = "<workspace version>"` (crates.io resolves path deps through the registry); the script fails the release on drift. When bumping the workspace version, bump those strings too — or just run the `--check`, which catches any mismatch.
- **Non-publishable members**: `minimon`, `run-wasm`, and the `dotzuki-template` dir are excluded from publishing (`publish = false` / workspace `exclude`).
- **Publishing from a mirrored machine**: the script pins `--registry crates-io`; mirrors like rsproxy lag behind crates.io and can break mid-sequence dependency resolution, so prefer the GitHub Actions workflow for actual releases.

## Releasing (Editor installers)

The same `vX.Y.Z` tag also packages the dotzuki-editor desktop app: `.github/workflows/release-editor.yml` builds the WASM pkgs once (Linux, release profile), packages the Electron app on macOS (arm64 + x64 dmg/zip) and Windows (nsis exe) — unsigned unless cert secrets are set — and attaches the installers to the GitHub Release. The editor's `package.json` version is synced to the workspace version during packaging, and the workflow asserts tag ↔ workspace version exactly like `publish-crates.sh` (so a `workflow_dispatch` run can only target the workspace version of the checked-out ref — no back-filling older tags). Linux AppImages are not CI-built; build locally with `pnpm electron:dist` in `workspace/tools/dotzuki-editor`.

## Known Gotchas
- A workspace-wide `cargo test` unifies features across crates and can fail feature-gated suites (e.g. `dotzuki-engine-script` embedded-scripts tests) that pass per-crate — re-run `cargo test -p <crate>` before assuming a real failure
- `crates/dotzuki-app/` is a workspace member since the repo split; it used to be a path-only dep
- `dotzuki-engine-script`'s `embedded-scripts` feature is a **no-op** (always generates an empty stub) — games embed their own scenes; the feature exists so consumers can still forward it
- `dotzuki-engine-dsl` keeps the generic `scene_check` bin (`cargo run -p dotzuki-engine-dsl --bin scene_check -- file.scene`) for editor draft-checking; the pokered-specific `scene_apply` bin moved to the pokered repo

## Files at This Level (repo root)
- `AGENTS.md` — This file. Project orientation for AI agents.
- `workspace/` — Cargo workspace root with all engine crates.
- `workspace/docs/` — Engine docs (battle engine guide, DSL specs, game-project spec).
- `workspace/scripts/` — Release tooling (`publish-crates.sh`, the crates.io publish entry point); game-specific scripts live in the game repos.
