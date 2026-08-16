# Publishing & Upgrading Guide

> - **Audience**: game authors, CI
> - **Type**: how-to
> - **Status**: active
> - **Last verified**: v0.1.0

Package, ship and upgrade a zero-Rust game project.

How to package, ship and upgrade a **zero-Rust game project** built with
dotzuki. This complements [the project manifest & layout](../reference/project-manifest.md)
(project contract) and [the CLI reference](../reference/cli.md) (tooling).

## What a game project is

A game project is a **plain directory** — `.dotzuki-editor.json` + `data/` +
`gfx/` + `assets/` (scenes). There is no build step: the `dotzuki` binary (or
the editor) consumes the directory as-is. Shipping a game = shipping this
directory plus a way to run it.

## 1. Deliver the project directory

There is no compile/package phase. Copy the whole project directory (excluding
`*.bak`, dotfiles and any editor state) to the target machine and run:

```bash
dotzuki run <project-dir>
```

Delivery checklist:

- Run [`dotzuki check`](../reference/cli.md) on the final tree — a clean exit is
  the only build check that exists.
- The project carries its own `dotzuki` version requirement implicitly: run it
  with a `dotzuki` binary whose engine version matches what the project was
  developed against. There is no per-project pin inside the manifest.
- Save files are written to `<project>/.dotzuki-save.json` by default — ship
  the directory writable, or point `--save-file` elsewhere for read-only
  installs.

## 2. Automate smoke tests (CI)

```bash
dotzuki run . --headless --frames 60          # boot, no window, no save
dotzuki run . --headless --map StartTown --screenshot shot.png --save
```

`--headless` never opens an audio device or window; `--screenshot` dumps the
real rendered final frame. See [the CLI reference](../reference/cli.md).

## 3. Playable demo in a web page (WASM)

The same runner compiles to WASM (`dotzuki-runner-web`) and boots against an
**in-memory filesystem** — the editor's Play activity uses exactly this path,
so a project that plays in the editor plays identically in a page.

The editor bundles the project as

```
{ "<posix rel path>": "<base64>" }   // whole project, incl. .dotzuki-editor.json
```

(excluding `node_modules`/`.git`/`target`/`dist`, dotfiles and `*.bak`;
per-file cap 16 MB, total 64 MB). The page then drives:

| `WasmRunner` method | Purpose |
|---|---|
| `new(filesJson, saveJson?)` | Boot with the bundled files; optionally import a save |
| `tick(inputBitmask)` | Advance one frame; returns the RGBA frame buffer |
| `take_audio()` | Pull generated stereo samples (`f32`, interleaved) |
| `width()` / `height()` | Frame size (320×240) |
| `export_save()` / `import_save(json)` | Save export/import (e.g. into `localStorage`) |

The input bitmask is the GB button mask used by `dotzuki_renderer::input`
(Up/Down/Left/Right/A/B/Start/Select). The editor's
`src/composables/useWasmRunner.ts` is a working reference for wiring input,
audio and save persistence.

## 4. Upgrading the engine

**Zero-Rust projects** — there is no dependency manifest; "upgrade" means using
a newer `dotzuki` binary / editor. Before upgrading:

1. Run `dotzuki check .` on the old toolchain — a clean tree is the safest
   starting point.
2. Re-check with the new binary, then boot once and verify the game state.
3. Save compatibility: saves are versioned (`.dotzuki-save.json`,
   `SAVE_VERSION` = 3). A save with `version <= SAVE_VERSION` loads; a save
   **newer** than the running engine is refused and the game starts fresh
   (the file is not deleted). Downgrading the engine after saving with a newer
   version is the one way to lose a save — keep a backup of
   `.dotzuki-save.json` around upgrades.

**Rust game repositories** (consume the engine as Cargo git dependencies):

```bash
# bump the tag in Cargo.toml, then
cargo update        # re-resolve the git dependency to the new tag
cargo build
```

Upgrade = bump tag + `cargo update`. See the engine README "Using the engine
from a game repo". The same save-version rules apply: a newer engine reads
older saves (v1/v2/v3 load fine); an older engine refuses newer ones.
