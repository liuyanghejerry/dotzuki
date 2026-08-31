# dotzuki CLI Reference

> - **Audience**: game authors, CI
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.5.5

Every `dotzuki` subcommand, flag and exit code for scaffolding, validating,
running and exporting zero-Rust game projects.

The `dotzuki` binary (`crates/dotzuki-cli`) scaffolds, validates and runs
**zero-Rust game projects** — plain directories of DSL, data and assets plus a
`.dotzuki-editor.json` manifest (see [the project manifest](project-manifest.md)).

Build it from the workspace root:

```bash
cd workspace
cargo build --release --bin dotzuki
```

The binary is `target/release/dotzuki`. All commands take a project path; the
manifest, not the CLI, defines the project layout.

## Subcommands

| Command | Purpose |
|---|---|
| `dotzuki new <name>` | Scaffold a new game project (layout identical to the editor's empty template) |
| `dotzuki check <dir>` | Compile every DSL file in the project and report diagnostics; exit 1 on errors. Also validates the `battle` section when present |
| `dotzuki run <dir>` | Boot the project and play it in a window (or headless for CI/screenshots) |
| `dotzuki export --web <dir>` | Export the project as a static web site (player page + bundle + WASM runner) |
| `dotzuki export --native <dir>` | Export the project as a native app directory (dotzuki-player binary + bundle) |

## `dotzuki new <name>`

Scaffolds a new project. `name` must be a slug: `[a-z0-9][a-z0-9-]*`.

| Flag | Default | Meaning |
|---|---|---|
| `--dir <parent>` | current directory | Parent directory the new project is created in |
| `--title <name>` | the slug | Display name stored in the manifest root `name` field |
| `--template <name>` | `empty` | Project template: `empty` (the editor's empty layout) or `your-first-game` (the tutorial project from [the tutorial](../tutorials/your-first-game.md), embedded in the CLI) |

Generated layout: `.dotzuki-editor.json` + `data/` (maps, tiles,
stories/characters/quests/arcs), `gfx/`, `assets/scenes/main.scene`, README —
the seven editor activities (maps / scripts / play / data / story / assets /
tiles). `--template your-first-game` writes the full tutorial project
instead — town, clearing, scripted battle, random encounters and save —
with the project name substituted into its manifest.

```bash
dotzuki new my-game --dir ~/projects --title "My Game"
dotzuki new my-game --dir ~/projects --template your-first-game
cd ~/projects/my-game
```

## `dotzuki check <dir>`

Compiles all discovered DSL files (`.scene` / `.gui` / `.theme` / `.style`) in
memory and reports diagnostics; exits non-zero if any file fails. When the
manifest has a `battle` section it additionally validates:

- referenced table ids exist in the `data` activities;
- `stats` / `skills` / `items` / `encounters` field names exist in the table
  schemas;
- the `rules` file parses and passes `validate_ruleset` (unknown events, ops,
  stats, types and resources are load-time errors).

```bash
dotzuki check .
```

## `dotzuki run <dir>`

Boots the project. Defaults to a windowed 320×240 (scalable) game loop.

| Flag | Default | Meaning |
|---|---|---|
| `--map <id>` | manifest `game.entryMap` | Map to spawn on (overrides the manifest) |
| `--lang <en\|zh>` | `en` | UI / script language (`@t` bilingual text selects on this) |
| `--headless` | off | Run without a window — for smoke tests and screenshots |
| `--frames <n>` | `120` | Headless: number of frames to simulate |
| `--screenshot <file.png>` | — | Headless: dump the final frame to a PNG |
| `--save` | off | Headless: also write the save file (windowed runs always save) |
| `--save-file <path>` | `<project>/.dotzuki-save.json` | Save file location |
| `--fresh` | off | Ignore an existing save file and start from scratch |
| `--watch` | off | Hot-reload scenes and the current map on file change. **Windowed only** — ignored with `--headless` |
| `--scale <n>` | `3` | Window scale factor |

Examples:

```bash
# Play a project
dotzuki run .

# CI smoke test: boot 60 frames headless, no window, no save
dotzuki run . --headless --frames 60

# Headless screenshot for previews
dotzuki run . --headless --map TownSquare --screenshot shot.png

# Iterate with hot reload
dotzuki run . --watch
```

## `dotzuki export --web <dir>`

Packs the project into a **static web site** that plays in any modern browser
— the same `WasmRunner` (dotzuki-runner-web) boot path as the editor's Play
activity, so an exported game plays identically to the in-editor playtest.

| Flag | Default | Meaning |
|---|---|---|
| `--out <dir>` | `<project>/dist/web` | Output directory (`dist` is excluded from bundles, so re-exporting never packs a previous export) |
| `--runner-pkg <dir>` | workspace pkg | Use this prebuilt dotzuki-runner-web wasm package directory (no wasm-pack needed) |
| `--rebuild-runner` | off | Rebuild the runner wasm package with wasm-pack even when a prebuilt one exists |
| `--save-key <key>` | `dotzuki-save:<title>` | localStorage key the player page persists saves under — hosts embedding the export (e.g. dotzuki-cloud) pin their own key so existing players keep their saves |
| `--lang <en\|zh>` | `en` | Player page UI language (loading/status/hint strings) |
| `--force` | off | Export even when validation reports diagnostics |

The export first runs the same diagnostics as `dotzuki check`; any diagnostic
aborts the export unless `--force` is given. The output directory contains:

```
dist/web/
├── index.html                      # player page: canvas, keyboard, WebAudio, localStorage saves
├── game.bundle.json                # { dotzuki: {tool, version, exportedAt}, files: {path: base64} }
└── wasm/
    ├── dotzuki_runner_web.js       # wasm-pack glue
    └── dotzuki_runner_web_bg.wasm  # the runner itself
```

Bundle rules (identical to the editor's play bundle): everything except
`node_modules`/`.git`/`target`/`dist`, dot-directories, dotfiles and `*.bak` —
except `.dotzuki-editor.json`, which always ships. Caps: 16 MB per file, 64 MB
total (uncompressed). The `dotzuki.version` field records the exporting CLI
version; it is informational and nothing enforces it at runtime.

The runner wasm package is resolved in this order: `--runner-pkg` → the
prebuilt `workspace/crates/dotzuki-runner-web/pkg` → build it with
`wasm-pack build --target web --release --features modern-audio`. The last two
require a dotzuki source checkout; a `cargo install`ed CLI outside the repo
must pass `--runner-pkg`.

```bash
dotzuki export --web . --out dist/web
python3 -m http.server --directory dist/web   # play at http://localhost:8000
```

## `dotzuki export --native <dir>`

Packs the project into a **native app directory**: the game-agnostic
`dotzuki-player` binary (the bin target of `dotzuki-runner`) plus the same
`game.bundle.json` the web export writes. The player boots the bundle next to
its executable through the same `RunnerGame` + window loop as `dotzuki run`,
and writes its save next to the bundle as `.dotzuki-save.json`.

| Flag | Default | Meaning |
|---|---|---|
| `--out <dir>` | `<project>/dist/native` | Output directory (`dist` is excluded from bundles, so re-exporting never packs a previous export) |
| `--player-bin <path>` | cargo build | Use this prebuilt `dotzuki-player` binary instead of building it |
| `--force` | off | Export even when validation reports diagnostics |

The diagnostic gate and bundle rules are identical to `--web`. The output
directory contains:

```
dist/native/
├── <project-dir-name>[.exe]   # the player binary, renamed after the project directory
└── game.bundle.json           # { dotzuki: {tool, version, exportedAt}, files: {path: base64} }
```

The player binary is resolved in this order: `--player-bin` →
`cargo build --release -p dotzuki-runner --bin dotzuki-player` in the source
workspace (incremental, so repeat exports are cheap). The build requires a
dotzuki source checkout; a `cargo install`ed CLI outside the repo must pass
`--player-bin`. The build targets the **host platform only** — to ship other
OSes, run the export on that OS (or on a per-OS CI runner).

```bash
dotzuki export --native . --out dist/native
dist/native/my-game            # double-clickable native app
```

The shipped binary also accepts an optional bundle path argument plus
`--lang en|zh`, `--scale <n>`, `--fresh`, and `--headless` (with `--frames` /
`--screenshot`) for CI smoke tests of the exported artifact:

```bash
dist/native/my-game --headless --frames 120 --screenshot boot.png
```

## Exit codes

- `dotzuki check`: `0` = all DSL compiles (and battle section validates); `1` = diagnostics found.
- `dotzuki run`: `0` = clean exit.
- `dotzuki export --web`: `0` = site written; `1` = validation failed (without `--force`), project over the bundle caps, or no runner wasm package available.
- `dotzuki export --native`: `0` = app directory written; `1` = validation failed (without `--force`), project over the bundle caps, or no player binary available.

## Notes

- Save files are versioned (`.dotzuki-save.json`); `--fresh` starts over without
  touching the file.
- Headless runs simulate the full frame loop including scene / battle
  dispatch, so `--screenshot` output reflects real rendered state.
- The editor's Play activity uses the same runner via WASM
  (`dotzuki-runner-web`), not this CLI.
