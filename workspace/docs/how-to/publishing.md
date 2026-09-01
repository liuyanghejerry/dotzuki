# Publishing & Upgrading Guide

> - **Audience**: game authors, CI
> - **Type**: how-to
> - **Status**: active
> - **Last verified**: v0.5.5

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

The one-command route is [`dotzuki export --web`](../reference/cli.md):

```bash
dotzuki export --web . --out dist/web
```

It validates the project (same diagnostics as `dotzuki check`; `--force`
overrides), then writes a self-contained static site: an `index.html` player
page (pixel-scaled canvas, keyboard input, WebAudio sound, saves in
`localStorage`), `game.dzpk` (the whole project as one binary pack — a JSON
index plus every file's raw bytes, with an informational `dotzuki.version`
stamp), and the WASM runner under `wasm/`. Upload the
directory to any static host — itch.io, GitHub Pages, S3 — and it plays.

The dotzuki-editor does this without the terminal: the Play activity's
**Export Web** button calls `POST /api/export`, which shells out to the same
CLI export and writes `dist/web/` in the open project (the packaged desktop
app ships the `dotzuki` binary for exactly this).

Pack limits: `node_modules`/`.git`/`target`/`dist`, dot-directories,
dotfiles and `*.bak` are excluded; a single file over 16 MB or a total over
64 MB (uncompressed) is refused.

To build a **custom player page** instead, drive `WasmRunner` yourself — the
generated `index.html` is the reference implementation:

| `WasmRunner` method | Purpose |
|---|---|
| `WasmRunner.fromPack(bytes, saveJson?)` | Boot from a `game.dzpk` pack (`Uint8Array`); optionally import a save |
| `new(filesJson, saveJson?)` | Boot with a `{ path: base64 }` JSON files map (the editor's Play path); optionally import a save |
| `tick(inputBitmask)` | Advance one frame; returns the RGBA frame buffer |
| `take_audio()` | Pull generated stereo samples (`f32`, interleaved) |
| `width()` / `height()` | Frame size (320×240) |
| `export_save()` / `import_save(json)` | Save export/import (e.g. into `localStorage`) |

The input bitmask is the GB button mask used by `dotzuki_renderer::input`
(Up/Down/Left/Right/A/B/Start/Select). The editor's
`src/composables/useWasmRunner.ts` shows the same wiring inside a larger app.

## 4. Native app directory

[`dotzuki export --native`](../reference/cli.md) packs the project into a
distributable native app directory:

```bash
dotzuki export --native . --out dist/native
dist/native/my-game            # double-clickable native app
```

The output is the game-agnostic `dotzuki-player` binary (renamed after the
project directory) plus the same `game.dzpk` pack the web export writes.
The player boots the pack sitting next to the executable through the same
runtime as `dotzuki run` — window, audio, and saves (`<exe
dir>/.dotzuki-save.json`) all behave like a local playtest. Zip the directory
to distribute it; the pack carries an informational `dotzuki.version`
stamp recording which CLI produced it. (Packs from older CLIs —
`game.bundle.json`, base64 JSON — still boot; the player sniffs the format
from the magic bytes.)

The export builds the player with `cargo build --release` from a dotzuki
source checkout (pass `--player-bin` to reuse a prebuilt binary instead).
Builds are **host-platform only** — ship Windows/Linux builds by running the
export on those OSes (or on per-OS CI runners). The same `dotzuki check`
diagnostic gate as the web export applies (`--force` overrides).

Ship the directory **writable**, or players on read-only installs lose saves
— the save file lives next to the pack.

The editor's Play activity has an **Export Native** button too — same
`POST /api/export` route, writing `dist/native/` in the open project. In a
dev checkout the CLI cargo-builds the player; packaged desktop apps ship a
prebuilt one (`Resources/cli/dotzuki-player`).

## 5. Upgrading the engine

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
