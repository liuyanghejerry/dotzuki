# Resource Manager Reference

> - **Audience**: rust developers
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.5.4

The PNG → tile-data pipeline of `dotzuki-renderer`
(`crates/dotzuki-renderer/src/resource.rs`): grayscale PNG to [2bpp](./glossary.md)
[tileset](./glossary.md) data, 1bpp fonts, 4bpp/RGBA conversion, `gfx/` path
resolution via `AssetRoot`, and the caching `ResourceManager`.

## Feature gate

The module lives behind the `resource` feature of `dotzuki-renderer`
(`resource = ["dep:image"]`; the backing `image` 0.25 dependency builds with
`default-features = false` plus the PNG codec):

| Feature | Effect | Default |
|---|---|---|
| `resource` | compiles `dotzuki_renderer::resource` | off |
| `gpu` | includes `resource` | on (`default = ["gpu"]`) |

A consumer on `default-features = false` that omits `resource` — the runner
enables only `image-assets` — compiles the module out entirely.

## Errors

All fallible calls return `resource::Result<T>` over `ResourceError`:

| Variant | Cause |
|---|---|
| `AssetRootNotFound(PathBuf)` | No asset directory at construction or auto-detect |
| `PngNotFound(PathBuf)` | `resolve_checked` miss; on wasm/mobile also a missing embedded entry |
| `ImageError` | PNG decode failure (from `image::ImageError`) |
| `InvalidDimensions { width, height }` | Pixel dimensions not multiples of 8 |
| `InvalidGrayscale { value, x, y }` | Declared for strict-validation callers; the module's own converters snap instead of raising it |
| `Io` | Filesystem error (from `std::io::Error`) |

## Grayscale convention

Classic GB PNGs use exactly four gray levels. `grayscale_to_color_index` snaps
each pixel to the nearest band:

| Gray value | Snapping band | Color index |
|---|---|---|
| 255 (white) | 213–255 | 0 (lightest) |
| 170 | 128–212 | 1 |
| 85 | 43–127 | 2 |
| 0 (black) | 0–42 | 3 (darkest) |

Variants: `grayscale_to_color_index_strict` accepts only the exact anchors
(255/170/85/0) and returns `None` for anything else; `bw_to_color_index` maps
≥128 to 0 (white) and <128 to 3 (black) for 1bpp sources;
`grayscale_to_16_levels` maps to 0–15 for 4bpp via `(value * 16) / 256`,
clamped at 15.

## Encodings and converters

Every converter reads the image left-to-right, top-to-bottom in 8×8 tile
units; both dimensions must be multiples of 8, else `InvalidDimensions`.

- **2bpp** — `png_to_2bpp` returns 16 bytes per tile: per row the lo byte then
  the hi byte, bit 7 = leftmost pixel. `png_to_tileset_2bpp` wraps the bytes
  in `TileSet::from_2bpp`.
- **1bpp** — `png_to_1bpp` returns 8 bytes per tile, one byte per row; bit 1 =
  black (color 3). `png_to_tileset_1bpp` wraps it. For fonts.
- **4bpp** — `png_to_4bpp` returns 32 bytes per tile as two sequential
  2bpp-style bitplanes: plane 0 = low 2 bits, plane 1 = high 2 bits
  (GBA-style). `png_to_tileset_4bpp` wraps it.
- **RGBA** — `png_to_rgba` returns a flat row-major `Vec<Rgba>` with no
  [palette](./glossary.md) remapping; `png_to_tileset_rgba` wraps it.

Free functions load one file without caching: `load_tileset_from_png`,
`load_tileset_from_png_1bpp`, `load_2bpp_from_png`, `load_1bpp_from_png`.

```rust
use dotzuki_renderer::resource::png_to_2bpp;

// 8×8, first row alternates white/black → color indices [0, 3, 0, 3, ...]
let mut img = image::GrayImage::from_pixel(8, 8, image::Luma([255]));
for col in (1..8).step_by(2) {
    img.put_pixel(col, 0, image::Luma([0]));
}
let data = png_to_2bpp(&image::DynamicImage::ImageLuma8(img)).unwrap();
assert_eq!(data.len(), 16); // one tile
assert_eq!((data[0], data[1]), (0x55, 0x55)); // row 0: lo byte, hi byte
```

*Verified by `png_to_2bpp_alternating_colors` in
`crates/dotzuki-renderer/src/resource.rs`.*

## AssetKind — game-owned categories

```rust
pub trait AssetKind: Copy + Eq + std::hash::Hash {
    fn subdir(self) -> &'static str;
    fn is_1bpp(self) -> bool { false }
}
```

*Verified by `resource_manager_category_default_encoding` in
`crates/dotzuki-renderer/src/resource.rs`.*

The game implements `AssetKind` for its own category enum, so the directory
layout stays game-owned. Font-style categories override `is_1bpp` to decode as
1bpp by default.

## AssetRoot — path resolution

`AssetRoot` points at the asset directory (conventionally `gfx/`):

- `AssetRoot::new(gfx_dir)` — errors `AssetRootNotFound` when the path is not
  a directory.
- `AssetRoot::from_parent(parent)` — joins `gfx/` under `parent`.
- `AssetRoot::new_wasm()` — skips filesystem validation (placeholder `gfx`);
  on wasm32 loads resolve through the embedded loader, never the path.
- `AssetRoot::auto_detect()` — resolution order:
  1. the `DOTZUKI_GFX_DIR` env var, pointing at the `gfx/` directory (warns
     and falls through when invalid),
  2. `<cwd>/gfx`,
  3. `gfx/` in the cwd's parent directories, walking up at most 5 levels,
  4. `<exe-dir>/gfx`,
  and errors `AssetRootNotFound` when all fail.

Lookups: `gfx_dir()`; `resolve(category, filename)` joins
`gfx/<subdir>/<filename>`; `resolve_checked` also errors `PngNotFound` when
the file is missing; `list_pngs(category)` returns the category's PNG files
sorted (a missing subdirectory yields an empty list).

## ResourceManager — load and cache

`ResourceManager<K: AssetKind>` loads on demand and caches in one
`HashMap<(K, String), CachedTileSet>`. There is no eviction policy — a game's
asset set is assumed bounded. `CachedTileSet` carries `tileset`,
`source_size`, and `tile_count` (all public).

| Method | Behaviour |
|---|---|
| `new(root)`, `root()` | Construction and accessor |
| `load_asset(category, filename)` | Category's default encoding; filename taken verbatim |
| `load_asset_2bpp`, `load_asset_1bpp` | Forced encodings, cached under `:2bpp` / `:1bpp` suffix keys |
| `load_tileset_4bpp(category, name)` | 4bpp, cached under a `:4bpp` key; returns `Result<&TileSet, String>` |
| `load_tileset_rgba_tileset(category, name)` | RGBA `TileSet`, cached under `:rgba`; honors the embedded seam |
| `load_tileset_rgba(category, name)` | `RgbaTileSet`; not cached, raw `std::fs`, no embedded path |
| `load(category, name)` | Appends `.png` when missing, then `load_asset` |
| `is_cached`, `cache_size`, `evict`, `clear_cache` | Cache introspection and control |
| `preload_category(category)` | Bulk-load; per-file errors ignored, returns the success count |
| `set_embedded_loader(loader)` | Registers the [embedded asset loader](./glossary.md) |

`load`, `load_tileset_4bpp`, `load_tileset_rgba_tileset`, and
`load_tileset_rgba` auto-append `.png`; the `load_asset*` family takes the
filename verbatim — passing `"a"` to `load_asset` looks for a file named `a`
and misses the `"a.png"` cache entry.

`LoadedPng` is the decoded intermediate: `load(path)` from disk,
`load_from_bytes(&[u8])` for embedded bytes, then `to_2bpp()`, `to_1bpp()`,
`to_tileset(is_1bpp)`, `tiles_x()`, `tiles_y()`.

### The embedded-asset seam

On wasm32, Android, and iOS the raw loaders resolve `"{subdir}/{filename}"`
through the registered `EmbeddedAssetLoader` — a
`fn(&str) -> Option<&'static [u8]>` mapping an asset-root-relative path to
embedded PNG bytes — and decode via `LoadedPng::load_from_bytes`; on native
targets they read from disk. With no loader registered on those targets every
load fails `PngNotFound`, and `LoadedPng::load` always fails on wasm32 (there
is no filesystem). The [seam](./glossary.md) is inert on native.

### Example

```rust
use dotzuki_renderer::resource::{AssetKind, AssetRoot, ResourceManager};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum TestKind { Tiles, Font }

impl AssetKind for TestKind {
    fn subdir(self) -> &'static str {
        match self { Self::Tiles => "tiles", Self::Font => "font" }
    }
    fn is_1bpp(self) -> bool { matches!(self, Self::Font) }
}

let root = AssetRoot::new("gfx")?; // gfx/tiles/a.png, gfx/font/f.png, ...
let mut mgr = ResourceManager::<TestKind>::new(root);

// Category default encoding; the filename is taken verbatim.
let tiles = mgr.load_asset(TestKind::Tiles, "a.png")?;
println!("{} tiles (source {:?})", tiles.tile_count, tiles.source_size);

// `load` appends .png itself; Font overrides is_1bpp → decoded as 1bpp.
let _font = mgr.load(TestKind::Font, "f")?;
assert!(mgr.is_cached(TestKind::Font, "f.png"));

assert!(mgr.evict(TestKind::Tiles, "a.png"));
mgr.clear_cache();
assert_eq!(mgr.cache_size(), 0);
```

*Verified by `resource_manager_caches_by_category_and_filename` and
`resource_manager_category_default_encoding` in
`crates/dotzuki-renderer/src/resource.rs`.*

## Gotchas

- Filename handling differs by entry point: `load_asset*` verbatim, `load` and
  the `load_tileset_*` family auto-append `.png`.
- `load_tileset_rgba` bypasses the cache and the embedded seam — it reads with
  raw `std::fs`, so it works on native targets only.
- On wasm32, register the loader with `set_embedded_loader` and build the root
  with `AssetRoot::new_wasm()`, or every load fails.
- The engine has no in-repo consumer for this module: it is a game-facing API.
