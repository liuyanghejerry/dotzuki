# Assets

How to manage game assets: tilesets and the shared tile library, converting
Game Boy 2bpp art, fonts, and where each file lives.

> - **Audience**: game authors
> - **Type**: how-to
> - **Status**: active
> - **Last verified**: v0.1.0

Before you start, read [Authoring Maps](./maps.md) for the map side of
tilesets and [the project manifest](../reference/project-manifest.md) for
the asset-directory contract; [Your First Game in the
Editor](../tutorials/editor-first-game.md) is the guided editor tour.

## Where assets live

The manifest's `assets` activity declares the asset directories —
`config.roots` (project-root-relative paths) with optional `extensions` —
and the editor's Assets activity lists exactly those roots. By convention
`gfx/` is the loose-graphics root (tilesets, sprites):

```json
{ "id": "assets", "type": "assets",
  "config": { "roots": ["gfx"], "extensions": [".png", ".json"] } }
```

The scaffolded project ships a working layout: `assets/tileset.png` (a 32×8
demo sheet), `assets/scenes/`, and `data/tiles/` — the shared tile library
that backs the map editor's tile picker (Backdrop/Trace). Everything
outside the declared roots is project data, not managed assets.

## Tilesets

A tileset is the `tileset.png` atlas plus its Tiled metadata: full-color
RGBA, 8×8-pixel tiles laid out horizontally, [GIDs](../reference/glossary.md)
1-based and row-major. A map's `map.tmx.json` references GIDs from its own
`tileset.png`; the collision layer marks blocked tiles with non-zero GIDs —
the full map contract is in [Authoring Maps](./maps.md).

The `.tsx` file names the same sheet for Tiled, so the map editor can
offer the tiles as a palette. The scaffolder seeds a per-map
`tileset.png` next to its `script.scene`; reusable sheets live in the
shared `data/tiles/` library.

## Converting Game Boy 2bpp art

[`tools/asset-converter/`](../../tools/asset-converter/README.md) turns
GB-style 2bpp tilesets (4-shade grayscale PNGs) into true-color RGBA
tilesets under a palette you supply, and writes the `.tsx` alongside. The
input shades map to 2bpp indices like this:

| Gray value | Palette index | Meaning |
|---|---|---|
| 0–63 | 3 | black (darkest) |
| 64–127 | 2 | dark gray |
| 128–191 | 1 | light gray |
| 192–255 | 0 | white (lightest) |

The palette is a JSON file of four RGBA colors, in index order:

```json
{
  "name": "my-palette",
  "colors": [
    { "r": 255, "g": 255, "b": 255 },
    { "r": 200, "g": 200, "b": 200 },
    { "r": 96,  "g": 96,  "b": 96 },
    { "r": 0,   "g": 0,   "b": 0 }
  ]
}
```

Convert one sheet, or every PNG in a directory:

```sh
cargo run -- -i tileset_2bpp.png -p custom_palette.json -o tileset_rgba.png

cargo run -- --all --input-dir gfx/tilesets --output-dir assets/converted \
  --batch-palette custom_palette.json
```

The converter is a Rust tool in the engine repository; run it from
`tools/asset-converter/`. It produces the `tileset.png` +
`.tsx` pair the map contract expects — the step between "ripped GB art"
and "usable dotzuki tileset".

## Fonts

Game text needs no font files: the renderer embeds a 10px monospaced
bitmap font (Fusion Pixel, OFL-1.1) with CJK coverage, so bilingual text
renders out of the box — [Bilingual Text (i18n)](./i18n.md) covers the
text side. Rust games can substitute their own font tilesets through the
renderer's resource provider; see [Rust API](../reference/rustdoc.md) for
the crate map.

## The editor workflow

The editor's Assets activity shows the manifest's asset roots; the Tiles
activity serves the shared `data/tiles/` library to the map editor. Author
in the editor, keep sheets under a declared root, and re-check the project
after asset swaps — `dotzuki check` compiles the DSL side, and
[`dotzuki run`](../reference/cli.md) shows the result in the player.
