# Publishing and upgrading a game

> - **Audience**: game authors, rust developers
> - **Type**: how-to
> - **Status**: active
> - **Last verified**: v0.12.0

Distribute a zero-Rust project as an editable directory or export it with a player.
Before you start, check the [project manifest](../reference/project-manifest.md) and
run the examples from your project's root directory.

## Deliver the editable project

Copy `.dotzuki-editor.json` and the data, graphics, and scene directories it names.
Use the same version of the CLI or editor that you developed the game with.
In the copied directory, validate the files and boot the game.

```bash
dotzuki check .
dotzuki run .
```

The runner writes saves to `.dotzuki-save.json` in the project directory. For a read-only
installation, use `dotzuki run . --save-file <writable-path>`.

## Smoke-test the project

```bash
dotzuki run . --headless --frames 60
dotzuki run . --headless --frames 120 --screenshot boot.png
```

Both commands run without a window or audio device. The second writes the last frame to a PNG.
Add `--save` to exercise save writing when the game reaches a stable point.

## Export for the web

```bash
dotzuki export --web . --out dist/web
python3 -m http.server --directory dist/web
```

Open `http://localhost:8000` to play. Upload the contents of `dist/web/` to a static host
to share the game. The directory contains `index.html`, the WebAssembly runner in `wasm/`,
and `game.dzpk`. The page handles keyboard input, WebAudio, and saves in `localStorage`.
In the desktop editor, **Play > Export Web** runs the same export with its bundled runner.
With a standalone CLI, pass the matching WebAssembly package using `--runner-pkg`.

Every export target validates the project. Fix any diagnostics before shipping. The
`--force` option can write a pack with DSL errors, which the player reports at startup.
The pack includes the manifest and source files. For a valid project with DSL files, it also
includes [compiled scene assets](../reference/glossary.md#compiled-scene-assets). A matching
player loads native functions on demand. Older players can read the bundled sources.
The CLI limits collected inputs to 16 MiB per file and 64 MiB in total. It skips build
directories, hidden files other than the manifest, and `*.bak`. Generated scene assets add to
the pack size. See the [CLI reference](../reference/cli.md) for the full collection rules.

For a custom player page, use the generated `index.html` as a working example.

| `WasmRunner` method | Purpose |
|---|---|
| `WasmRunner.fromPack(bytes, saveJson?)` | Boot a `.dzpk` from a `Uint8Array` and optionally restore a save |
| `new WasmRunner(filesJson, saveJson?, language?)` | Boot from the editor's JSON string of base64-encoded files |
| `advance(inputBitmask)` | Advance the simulation and audio by one frame |
| `present(ctx, full)` | Paint accumulated changes to a 2D canvas. Pass `true` after a resize or context restoration |
| `tick(inputBitmask)` | Advance one frame and return a complete RGBA snapshot |
| `take_audio()` | Drain interleaved stereo `f32` samples at 44.1 kHz |
| `width()` / `height()` | Read the framebuffer dimensions (320 × 240) |
| `export_save()` / `import_save(json)` | Export the current save when available or restore a saved game |

Call `advance` for each simulation tick, then call `present` once on the retained canvas.
For a host that needs a full pixel buffer, `tick` performs the simulation step itself.
The input mask uses bits 0–7 for A, B, Select, Start, Right, Left, Up, and Down.

## Export for native desktops or mobile

```bash
dotzuki export --native . --out dist/native
dist/native/game --headless --frames 120 --screenshot native.png
```

The CLI prints the executable path. With `.` as the project argument, it writes `game`
(`game.exe` on Windows). A named directory such as `my-game` produces `my-game`.
Distribute the executable together with `game.dzpk`. The player opens the adjacent pack and
writes saves next to it, so choose a writable installation directory. It can also load the
legacy `game.bundle.json` format.

Build on each desktop OS you ship for. A source checkout can build its host player with Cargo.
For a standalone CLI, pass a matching executable with `--player-bin`. **Play > Export Native**
in the desktop editor uses the bundled player. For mobile exports, follow the
[Android](export-android.md) or [HarmonyOS](export-harmonyos.md) guide for the target runtime.

## Upgrade an existing game

1. Back up `.dotzuki-save.json` and run `dotzuki check .` with the current toolchain.
2. Upgrade the CLI or editor. Check the project again, load the save, and play a scene and a
   battle. The runner accepts save formats 1–3. It rejects a newer format.
3. Re-export each target with the matching player or runtime to ship updated compiled assets.

For Rust games, update the `dotzuki-*` dependency versions or git tags together in
`Cargo.toml`, then run `cargo update` and `cargo build` in your game repository.
Consult the [migration guide](../release-notes/migration/v0.12.0.md) when upgrading a
custom battle or mobile host.
