# dotzuki CLI Reference

The `dotzuki` binary (`crates/dotzuki-cli`) scaffolds, validates and runs
**zero-Rust game projects** — plain directories of DSL, data and assets plus a
`.dotzuki-editor.json` manifest (see [`game-project-spec.md`](./game-project-spec.md)).

Build it from the workspace root:

```bash
cd workspace
cargo build --release --bin dotzuki
```

The binary is `target/release/dotzuki`. All commands take a project path; the
project layout is defined by the manifest, not by the CLI.

## Subcommands

| Command | Purpose |
|---|---|
| `dotzuki new <name>` | Scaffold a new game project (layout identical to the editor's empty template) |
| `dotzuki check <dir>` | Compile every DSL file in the project and report diagnostics; exit 1 on errors. Also validates the `battle` section when present |
| `dotzuki run <dir>` | Boot the project and play it in a window (or headless for CI/screenshots) |

## `dotzuki new <name>`

Scaffolds a new project. `name` must be a slug: `[a-z0-9][a-z0-9-]*`.

| Flag | Default | Meaning |
|---|---|---|
| `--dir <parent>` | current directory | Parent directory the new project is created in |
| `--title <name>` | the slug | Display name stored in the manifest (`game` section) |

Generated layout: `.dotzuki-editor.json` + `data/` (maps, tiles,
stories/characters/quests/arcs), `gfx/`, `assets/scenes/main.scene`, README —
the six editor activities (maps / scripts / play / data / story / assets /
tiles).

```bash
dotzuki new my-game --dir ~/projects --title "My Game"
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

## Exit codes

- `dotzuki check`: `0` = all DSL compiles (and battle section validates); `1` = diagnostics found.
- `dotzuki run`: `0` = clean exit.

## Notes

- Save files are versioned (`.dotzuki-save.json`); `--fresh` starts over without
  touching the file.
- Headless runs simulate the full frame loop including scene / battle
  dispatch, so `--screenshot` output reflects real rendered state.
- The editor's Play activity uses the same runner via WASM
  (`dotzuki-runner-web`), not this CLI.
