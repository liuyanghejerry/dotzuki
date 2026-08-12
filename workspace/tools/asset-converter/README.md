# asset-converter — GB 2bpp → RGBA tilesets

Converts Game Boy **2bpp tilesets** (stored as 4-shade grayscale PNGs) into
true-color RGBA tilesets with a user-supplied palette, and generates a Tiled
`.tsx` tileset definition alongside.

## 2bpp → grayscale mapping

GB 2bpp palette index 0 is the lightest (white), index 3 the darkest (black).
The input grayscale PNG encodes that as:

| Gray value | Palette index | Meaning        |
|------------|---------------|----------------|
| 0–63       | 3             | Black/darkest  |
| 64–127     | 2             | Dark gray      |
| 128–191    | 1             | Light gray     |
| 192–255    | 0             | White/lightest |

## Usage

```sh
# Single tileset: 2bpp PNG + palette JSON → RGBA PNG + .tsx
cargo run -- -i tileset_2bpp.png -p custom_palette.json -o tileset_rgba.png

# Batch: convert every PNG in a directory
cargo run -- --all --input-dir gfx/tilesets --output-dir assets/converted \
  --batch-palette custom_palette.json
```

Run from `tools/asset-converter/` (`cargo run -- …`) or build a binary once
(`cargo build --release`).

## Flags

| Flag | Meaning |
|---|---|
| `-i, --input <png>` | Input 2bpp tileset PNG (grayscale, 4 shades) |
| `-p, --palette <json>` | Palette JSON (4 RGBA colors, indices 0–3) |
| `-o, --output <png>` | Output RGBA tileset PNG |
| `--all` | Batch mode: convert all PNGs in `--input-dir` |
| `--input-dir <dir>` | Batch input directory (default `.`) |
| `--output-dir <dir>` | Batch output directory (default `./converted`) |
| `--batch-palette <json>` | Palette for batch mode |
| `--tile-count <n>` | Tile count for `.tsx` (0 = auto-detect) |
| `--columns <n>` | Columns in the tileset sheet (default 16) |
| `--no-tsx` | Skip `.tsx` generation |
| `--all-monster` | Alias for `--all` (legacy workflow) |

## Palette JSON shape

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

Each color maps to 2bpp index 0–3 in order; `a` defaults to 255.
