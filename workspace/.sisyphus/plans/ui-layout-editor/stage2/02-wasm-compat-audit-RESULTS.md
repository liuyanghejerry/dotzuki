# Stage 2.2 — Wasm Compat Audit Results

**Date**: 2026-05-12
**Branch**: `feat/ui-layout-editor`
**Audit Type**: READ-ONLY (no code changes)

---

## TL;DR

- ✅ `pokered-data` — **green**: builds cleanly for wasm32, zero changes needed
- 🟡 `pokered-core` — **yellow**: fails wasm32 build due to `getrandom` (js feature) + missing wasm32 cfg variant for `ScriptLoader::load_auto`; resolves with `embedded-scripts` feature
- 🔴 `pokered-renderer` — **red**: builds for wasm32 but **always compiles** `pixels`, `winit`, `winit_input_helper`, `image`, `wgpu` (crate-level deps, not feature-gated). `input.rs` and `resource.rs` are unconditionally included
- 🟡 `pokered-ui` — **yellow**: `FrameBufferPainter` only needs 4 items from `pokered-renderer` (all pure CPU), but transitively links the entire 4.3MB renderer rlib + 13MB winit + 39MB wgpu
- **4 wasm blockers found** (3 in renderer, 1 in core)
- **Recommended next action**: Add `framebuffer` / `gpu` feature split to `pokered-renderer` (per plan §3), then add `getrandom = { features = ["js"] }` cfg dep to `pokered-core`, then proceed to Stage 2.1

---

## Workspace Inventory

### pokered-ui Dependency Cone

```
pokered-ui
├── pokered-core  (⚠️)
│   ├── pokered-data  (✅)
│   ├── pokered-script  (✅, wasm-OK with embedded-scripts)
│   └── rand  (⚠️ needs getrandom/js for wasm)
├── pokered-data  (✅)
└── pokered-renderer  (🔴)
    ├── pokered-core  (⚠️)
    ├── pokered-data  (✅)
    ├── pixels  (🔴 — wgpu pipeline, 39MB rlib)
    ├── winit  (🔴 — windowing, 13MB rlib)
    ├── winit_input_helper  (🔴)
    ├── image  (🟡 — PNG only, 15MB rlib)
    └── getrandom  (✅ — already has js feature for wasm)
```

| Crate | Wasm Status | Direct Blockers | Artifact Size (debug) |
|-------|-------------|-----------------|-----------------------|
| `pokered-data` | ✅ PASS | None | 8.5MB rlib |
| `pokered-script` | ✅ PASS (with embedded-scripts) | None | 10MB rlib |
| `pokered-core` | ❌ FAIL (w/o embedded-scripts) | `getrandom` needs js feature; `ScriptLoader::load_auto` missing wasm32 cfg | 13MB rlib |
| `pokered-core` | ✅ PASS (with embedded-scripts) | None | 13MB rlib |
| `pokered-renderer` | ✅ PASS (compiles, with embedded-scripts) | Crate-level deps always compiled: `pixels`/`winit`/`image`; `input.rs` unconditionally imports winit; `resource.rs` unconditionally imports std::path/fs/image | 4.3MB rlib |
| `pokered-ui` | ✅ PASS (compiles, with embedded-scripts) | Transitively links all of pokered-renderer's heavy deps | 508KB rlib |

### Crates NOT in pokered-ui's Dependency Cone

| Crate | Status | Notes |
|-------|--------|-------|
| `pokered-audio` | ❌ wasm-hostile | `cpal` (ALSA/CoreAudio), `rodio` |
| `pokered-app` | ❌ wasm-hostile | Native binary, winit/pixels/audio |
| `pokered-tui` | ❌ wasm-hostile | `ratatui`, `crossterm`, `cpal` |
| `pokered-debug-server` | ❌ wasm-hostile | `tokio`, HTTP server |
| `pokered-web` | ✅ wasm-native | Already builds for wasm32 (149MB .wasm debug) |

---

## Empirical Build Results

All builds run from `/Users/liuyanghe02/develop/pokered/workspace/` on branch `feat/ui-layout-editor`.

### pokered-data → wasm32

**Command**: `cargo build -p pokered-data --target wasm32-unknown-unknown`

**Result**: ✅ **PASS** (42.94s)
No errors, no warnings.

```
Dependencies compiled: serde, serde_json, strum, strum_macros, num-derive, num-traits, thiserror, log
All pure Rust, no native deps.
```

### pokered-core → wasm32 (no features)

**Command**: `cargo build -p pokered-core --target wasm32-unknown-unknown --no-default-features`

**Result**: ❌ **FAIL** — 3 errors

```
Error 1 (getrandom):
  error: the wasm*-unknown-unknown targets are not supported by default,
  you may need to enable the "js" feature.
  → /getrandom-0.2.17/src/lib.rs:346

Error 2 (ScriptLoader::load_auto):
  error[E0599]: no method named `load_auto` found for struct `ScriptLoader`
  → crates/pokered-core/src/overworld/mod.rs:891

Root cause: load_auto has two cfg-gated impls:
  (a) #[cfg(feature = "embedded-scripts")] — line 243
  (b) #[cfg(all(not(feature = "embedded-scripts"), not(target_arch = "wasm32")))] — line 252
  On wasm32 without embedded-scripts, NEITHER impl is active → method not found.
```

### pokered-core → wasm32 (embedded-scripts)

**Command**: `cargo build -p pokered-core --target wasm32-unknown-unknown --features embedded-scripts`

**Result**: ✅ **PASS** (inferred from renderer build, as `pokered-core` is compiled as renderer dep)
Only warnings (unused variables, dead code), no errors.

### pokered-renderer → wasm32

**Command**: `cargo build -p pokered-renderer --target wasm32-unknown-unknown --features pokered-core/embedded-scripts`

**Result**: ✅ **PASS** (55.26s, with warnings only)
4 warnings (unused imports/variables/dead code), 0 errors.

### pokered-ui → wasm32

**Command**: `cargo build -p pokered-ui --target wasm32-unknown-unknown --features pokered-core/embedded-scripts`

**Result**: ✅ **PASS** (38.44s)
No errors, no new warnings beyond inherited from dependencies.

---

## Root-Cause Analysis

### Blocker 1: `getrandom` needs `js` feature for wasm32

- **Crate**: `pokered-core` (and any dependent that uses `rand`)
- **Blocker**: `rand` → `getrandom` panics at compile time on `wasm32-unknown-unknown` without `js` feature
- **Severity**: 🟡 Trivial fix (one line)
- **Mitigation**: Add to `pokered-core/Cargo.toml`:
  ```toml
  [target.'cfg(target_arch = "wasm32")'.dependencies]
  getrandom = { version = "0.2", features = ["js"] }
  ```
  (Same pattern already used by `pokered-renderer/Cargo.toml` line 17-18)

### Blocker 2: `ScriptLoader::load_auto` missing wasm32 cfg

- **Crate**: `pokered-script` → `pokered-core`
- **Blocker**: Two cfg-gated impls exist but neither covers `wasm32` without `embedded-scripts`
- **File**: `crates/pokered-script/src/loader.rs:242-275`
- **Severity**: 🟡 Medium fix (one cfg gate or stub)
- **Mitigation A** (preferred): Add a stub for wasm32 without embedded-scripts:
  ```rust
  #[cfg(all(not(feature = "embedded-scripts"), target_arch = "wasm32"))]
  pub fn load_auto(&mut self, _scripts_dir: Option<&std::path::Path>) -> Result<usize, ScriptLoaderError> {
      Ok(0) // wasm32: no filesystem, no scripts to auto-load
  }
  ```
- **Mitigation B**: Always enable `embedded-scripts` for wasm32 (simpler but hides the issue)
- **Mitigation C**: Gate the call site in `pokered-core/src/overworld/mod.rs:891` behind `#[cfg(not(target_arch = "wasm32"))]`

### Blocker 3: `pokered-renderer` crate-level deps are not feature-gated

- **Crate**: `pokered-renderer`
- **Blocker**: `Cargo.toml` has `pixels`, `winit`, `winit_input_helper`, `image` as **unconditional** dependencies (not `optional = true`)
- **File**: `crates/pokered-renderer/Cargo.toml:9-15`
- **Severity**: 🔴 Blocker for wasm preview binary size
- **Impact**: Even though code branches are cfg-gated, the crates are downloaded, compiled, and linked into the dependency tree. This bloats CI time and makes `cargo tree` for wasm preview show wgpu/winit — violating the Stage 2 exit gate requirement "No wgpu/winit/file-system code in the wasm dependency tree"
- **Mitigation**: Feature-gate these deps. See "Feature Gate Design" section below.

### Blocker 4: `input.rs` unconditionally imports `winit::keyboard::KeyCode`

- **Crate**: `pokered-renderer`
- **Blocker**: `use winit::keyboard::KeyCode;` at top of file — always compiled
- **File**: `crates/pokered-renderer/src/input.rs:1`
- **Severity**: 🔴 Blocker — if `winit` is made optional, this file won't compile without gating
- **Mitigation**: Gate `pub mod input;` behind `#[cfg(feature = "gpu")]` in `lib.rs`, OR gate the import + all uses of `KeyCode` inside `input.rs`

### Blocker 5: `resource.rs` uses `std::path`, `std::fs`, `image`

- **Crate**: `pokered-renderer`
- **Blocker**: Unconditional use of filesystem APIs + `image` crate
- **File**: `crates/pokered-renderer/src/resource.rs:11-13`
- **Severity**: 🔴 Blocker — must be gated behind native-only feature
- **Mitigation**: Gate `pub mod resource;` behind `#[cfg(feature = "gpu")]` in `lib.rs`
- **Cascade impact**: Modules that depend on `resource`:
  - `game_font.rs` (line 1: `use crate::resource::{...}`) → needs `GameFont` to be constructible without `ResourceManager`
  - `mon_icon.rs` (line 7: `use crate::resource::{...}`) → gate behind `gpu`
  - `party_hp_bar.rs` (line 15: `use crate::resource::{...}`) → gate behind `gpu`
  - `tests.rs` → test-only, gated with `#[cfg(test)]`

### Non-Blockers (compiles but would break at runtime)

| Module | Issue | Severity |
|--------|-------|----------|
| `debug_log.rs` (in pokered-core) | Uses `std::fs::File` for file logging | Low (logging not needed in wasm preview) |
| `OverworldScreen.scripts_dir` | `Option<std::path::PathBuf>` field | Low (dead field when not loading scripts) |

---

## Feature Gate Design

### Proposed Feature Split for `pokered-renderer`

Following the plan's design (from `04-risks-and-decisions.md`):
- `framebuffer` (default-on, wasm-safe): pure CPU rendering primitives
- `gpu` (default-on for native): winit/pixels/wgpu pipeline

#### Cargo.toml Changes (recommendation only, not applied)

```toml
# crates/pokered-renderer/Cargo.toml

[features]
default = ["framebuffer", "gpu"]
framebuffer = []                              # pure CPU primitives — wasm-safe
gpu = ["dep:pixels", "dep:winit", "dep:winit_input_helper", "dep:image"]  # native GPU pipeline

[dependencies]
pokered-data = { path = "../pokered-data" }
pokered-core = { path = "../pokered-core" }

# Always needed (pure CPU):
thiserror = { workspace = true }
log = "0.4"
error-iter = "0.4"

# Gated behind gpu feature:
pixels = { version = "0.15", optional = true }
winit = { version = "0.30", optional = true }
winit_input_helper = { version = "0.17", optional = true }
image = { version = "0.25", default-features = false, features = ["png"], optional = true }

[target.'cfg(target_arch = "wasm32")'.dependencies]
getrandom = { version = "0.2", features = ["js"] }
```

#### lib.rs Module Gating (recommendation)

```rust
// crates/pokered-renderer/src/lib.rs

// ── Always available (framebuffer feature — pure CPU) ──
pub mod embedded;              // wasm32 embedded assets (include_bytes!)
pub mod embedded_font;         // 8×8 bitmap font + draw functions
pub mod palette;               // GbColor, Palette, color tables
pub mod tile;                  // Tile decoding, TileSet
pub mod tilemap;               // 32×32 BG tile map
pub mod sprite;                // OAM-style sprite rendering
pub mod text_renderer;         // Screen tile buffer + tile write
pub mod textbox;               // Text box frame constants
pub mod menu;                  // Menu cursor, scroll indicators
pub mod layout;                // Coordinate conversion utilities
pub mod transition;            // Fade palette definitions (data only)
pub mod battle_scene;          // HUD, HP bars — pure CPU
pub mod battle_transition;     // Screen-wipe transitions — pure CPU
pub mod battle_anim;           // Animation system — pure CPU
pub mod viewport;              // Scroll state, coordinate conversion
pub mod window_layer;          // Window overlay — pure CPU

// ── Gated behind gpu feature ──
#[cfg(feature = "gpu")]
pub mod window;                // winit + pixels game loop
#[cfg(feature = "gpu")]
pub mod input;                 // winit::keyboard::KeyCode mapping
#[cfg(feature = "gpu")]
pub mod resource;              // PNG loading from filesystem

// ── Gated behind gpu feature (depend on resource) ──
#[cfg(feature = "gpu")]
pub mod game_font;             // ResourceManager-based font loading
// NOTE: game_font also needs a framebuffer-only constructor path
// (e.g., GameFont::from_embedded() using include_bytes!)
#[cfg(feature = "gpu")]
pub mod mon_icon;              // Party icon animation (needs ResourceManager)
#[cfg(feature = "gpu")]
pub mod party_hp_bar;          // Party HP bar renderer (needs ResourceManager)

// ── Always available constants ──
pub const SCREEN_WIDTH: u32 = 160;
pub const SCREEN_HEIGHT: u32 = 144;
pub const TILE_SIZE: u32 = 8;
pub const SCREEN_WIDTH_TILES: u32 = SCREEN_WIDTH / TILE_SIZE;
pub const SCREEN_HEIGHT_TILES: u32 = SCREEN_HEIGHT / TILE_SIZE;
pub const BYTES_PER_PIXEL: usize = 4;
pub const FRAMEBUFFER_SIZE: usize = (SCREEN_WIDTH as usize) * (SCREEN_HEIGHT as usize) * BYTES_PER_PIXEL;

// FrameBuffer and Rgba always available
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rgba(pub [u8; 4]);
// ... (Rgba impl) ...

#[derive(Debug, Clone)]
pub struct FrameBuffer {
    pub data: Vec<u8>,
}
// ... (FrameBuffer impl) ...
// save_png already cfg-gated: #[cfg(not(target_arch = "wasm32"))]
```

#### `game_font.rs` Refactoring Needed

`GameFont` is the critical bridging module — it's used by `FrameBufferPainter::draw_gb_tile` but currently loads fonts via `ResourceManager` (gpu-gated).

**Recommendation**: Split `GameFont` construction:
```rust
// Always available: construct from already-loaded data
impl GameFont {
    /// Create from pre-loaded tilesets (framebuffer-compatible)
    pub fn from_tilesets(main: TileSet, battle_extra: TileSet, ed: TileSet) -> Self { ... }

    /// Load from assets on disk (gpu feature only)
    #[cfg(feature = "gpu")]
    pub fn load(res: &mut ResourceManager) -> Result<Self> { ... }
}
```

The wasm preview would load font data from embedded assets (`include_bytes!`) and construct `GameFont::from_tilesets(...)`, while the native game continues using `GameFont::load(&mut ResourceManager)`.

### Impact on `pokered-ui-preview` (Stage 2.1)

The preview crate's `Cargo.toml` would declare:
```toml
pokered-renderer = { path = "../pokered-renderer", default-features = false, features = ["framebuffer"] }
```

This ensures:
- No `pixels`, `winit`, `wgpu` in the wasm dependency tree
- `FrameBufferPainter` gets everything it needs from `framebuffer` feature
- `cargo tree` shows clean output (no GPU/native crates)

### Public API Surface Preserved by `framebuffer` Feature

The following items remain public and available under `default-features = false, features = ["framebuffer"]`:

| Item | Module | Used By |
|------|--------|---------|
| `FrameBuffer` | `lib.rs` | `FrameBufferPainter` |
| `Rgba` | `lib.rs` | `FrameBufferPainter`, `engine.rs` |
| `SCREEN_WIDTH`, `SCREEN_HEIGHT`, `TILE_SIZE`, `SCREEN_WIDTH_TILES`, `SCREEN_HEIGHT_TILES` | `lib.rs` | `engine.rs`, `FrameBufferPainter` |
| `embedded_font::box_tiles` | `embedded_font.rs` | `FrameBufferPainter` |
| `embedded_font::draw_glyph` | `embedded_font.rs` | `FrameBufferPainter` |
| `embedded_font::draw_text` | `embedded_font.rs` | `FrameBufferPainter` |
| `embedded_font::fill_tile` | `embedded_font.rs` | `FrameBufferPainter` |
| `game_font::GameFont` | `game_font.rs` | `FrameBufferPainter` (optional) |
| `tile::TileSet` | `tile.rs` | `GameFont::from_tilesets` |
| All 15 `pokered-ui::menus::*` modules | `menus/` | Wasm preview render loop |

---

## Stage 2.1 Pre-Reqs Surfaced

These changes **MUST** land in `pokered-renderer` (and optionally `pokered-core`) **before** the `pokered-ui-preview` crate can be created. They are sequenced as pre-reqs because Stage 2.1's `Cargo.toml` already references `features = ["framebuffer"]` — that feature must exist first.

### Ordered Checklist

1. **[pokered-core] Add `getrandom/js` for wasm32** (~5 min)
   - File: `crates/pokered-core/Cargo.toml`
   - Add: `[target.'cfg(target_arch = "wasm32")'.dependencies]` / `getrandom = { version = "0.2", features = ["js"] }`
   - Verification: `cargo build -p pokered-core --target wasm32-unknown-unknown --no-default-features` passes getrandom compile error

2. **[pokered-script] Add wasm32 stub for `load_auto`** OR **[pokered-core] gate the call site** (~15 min)
   - File: `crates/pokered-script/src/loader.rs` (add cfg gate) OR `crates/pokered-core/src/overworld/mod.rs:891` (gate call site)
   - Mitigation A (preferred): Add `#[cfg(not(target_arch = "wasm32"))]` to bottom `load_auto` impl, add wasm32 stub returning `Ok(0)`
   - Verification: `cargo build -p pokered-core --target wasm32-unknown-unknown --no-default-features` passes `load_auto` error

3. **[pokered-renderer] Add `framebuffer` / `gpu` features** (~1-2 hours)
   - File: `crates/pokered-renderer/Cargo.toml`
   - Make `pixels`, `winit`, `winit_input_helper`, `image` `optional = true`
   - Add `[features]` section per design above
   - File: `crates/pokered-renderer/src/lib.rs`
   - Gate `window`, `input`, `resource`, `game_font`, `mon_icon`, `party_hp_bar` behind `#[cfg(feature = "gpu")]`
   - Keep `game_font` available under `framebuffer` with a `from_tilesets()` constructor
   - Verification:
     - `cargo build -p pokered-renderer` — native build still green ✅
     - `cargo build -p pokered-renderer --target wasm32-unknown-unknown --no-default-features --features framebuffer` — wasm build green ✅
     - `cargo tree -p pokered-renderer --target wasm32-unknown-unknown --no-default-features --features framebuffer` — no wgpu/winit ✅

4. **[pokered-ui] Verify `framebuffer` feature compatibility** (~30 min)
   - Verification: `cargo build -p pokered-ui --target wasm32-unknown-unknown --no-default-features` (after renderer gate is in place)
   - All existing test suites green: `cargo test --workspace`

5. **[pokered-renderer] Native build & test verification** (~30 min)
   - `cargo build --workspace` — all crates build
   - `cargo test -p pokered-renderer` — all renderer tests pass (will need cfg gating of test code that references winit/image)
   - `cargo test -p pokered-ui` — all UI tests pass

### Estimated Effort for Pre-Reqs

| Item | Effort |
|------|--------|
| getrandom/js fix | 5 min |
| load_auto stub | 15 min |
| framebuffer/gpu feature split | 1.5 hours |
| game_font refactoring | 30 min |
| Verification & test fixes | 1 hour |
| **Total** | **~3.5 hours** |

This is significantly less than the plan's budget of 2 days — the code is already well-structured for this split. No crate split is needed.

---

## Module-by-Module Classification

Full classification of every `pokered-renderer` module:

| Module | Wasm Status | Uses | Action |
|--------|-------------|------|--------|
| `battle_anim/` | ✅ Pure CPU | FrameBuffer, tile/sprite | Stay in `framebuffer` |
| `battle_scene.rs` | ✅ Pure CPU | palette, text_renderer, textbox | Stay in `framebuffer` |
| `battle_transition.rs` | ✅ Pure CPU | FrameBuffer | Stay in `framebuffer` |
| `embedded.rs` | ✅ wasm-specific | `include_bytes!` | Stay in `framebuffer` |
| `embedded_font.rs` | ✅ Pure CPU | FrameBuffer, Rgba | Stay in `framebuffer` (**critical for preview**) |
| `game_font.rs` | ⚠️ Needs refactor | `resource::ResourceManager` | Gate `load()` behind `gpu`; add `from_tilesets()` for `framebuffer` |
| `input.rs` | ❌ Uses winit | `winit::keyboard::KeyCode` | Gate behind `gpu` |
| `layout.rs` | ✅ Pure CPU | (none, pure math) | Stay in `framebuffer` |
| `lib.rs` | 🟡 Mixed | `image` in `save_png` (already cfg-gated) | Gate `save_png` already correct |
| `menu.rs` | ✅ Pure CPU | text_renderer, textbox | Stay in `framebuffer` |
| `mon_icon.rs` | ❌ Uses resource + Mutex | `resource::ResourceManager`, `std::sync::Mutex` | Gate behind `gpu` |
| `palette.rs` | ✅ Pure data | Rgba | Stay in `framebuffer` |
| `party_hp_bar.rs` | ❌ Uses resource + Mutex | `resource::ResourceManager`, `std::sync::Mutex` | Gate behind `gpu` |
| `resource.rs` | ❌ Uses std/fs/path/image | `std::path`, `std::fs`, `image` | Gate behind `gpu` |
| `sprite.rs` | ✅ Pure CPU | FrameBuffer, tile, palette | Stay in `framebuffer` |
| `tests.rs` | 🟡 Test-only | winit, std::path | Already gated `#[cfg(test)]`, may need minor cfg tweaks |
| `text_renderer.rs` | ✅ Pure CPU | palette, tile, FrameBuffer | Stay in `framebuffer` |
| `textbox.rs` | ✅ Pure data | text_renderer | Stay in `framebuffer` |
| `tile.rs` | ✅ Pure CPU | palette, Rgba | Stay in `framebuffer` |
| `tilemap.rs` | ✅ Pure CPU | palette, tile, FrameBuffer | Stay in `framebuffer` |
| `transition.rs` | ✅ Pure data | (none) | Stay in `framebuffer` |
| `viewport.rs` | ✅ Pure CPU | tilemap | Stay in `framebuffer` |
| `window.rs` | ❌ Uses winit/pixels/time | `pixels`, `winit`, `std::time`, `std::thread` | Already cfg-gated: `#[cfg(not(target_arch = "wasm32"))]` ✅ |
| `window_layer.rs` | ✅ Pure CPU | palette, tile, tilemap, FrameBuffer | Stay in `framebuffer` |

### Modules That Stay Public Under `framebuffer` (Total: 15)
`battle_anim`, `battle_scene`, `battle_transition`, `embedded`, `embedded_font`, `layout`, `menu`, `palette`, `sprite`, `text_renderer`, `textbox`, `tile`, `tilemap`, `transition`, `viewport`, `window_layer`

### Modules Gated Behind `gpu` (Total: 5)
`window` (already cfg-gated), `input`, `resource`, `game_font` (partial — `from_tilesets` stays), `mon_icon`, `party_hp_bar`

---

## What `FrameBufferPainter` Actually Needs

From `crates/pokered-ui/src/backends/framebuffer.rs`:

```rust
use pokered_renderer::embedded_font::{box_tiles, draw_glyph, draw_text, fill_tile};
use pokered_renderer::game_font::GameFont;
use pokered_renderer::{FrameBuffer, Rgba, TILE_SIZE};
```

**That's it.** The wasm preview only needs these 6 items:
1. `pokered_renderer::FrameBuffer` — struct + methods (pure CPU)
2. `pokered_renderer::Rgba` — color struct (pure data)
3. `pokered_renderer::TILE_SIZE` — constant (8)
4. `pokered_renderer::embedded_font::box_tiles` — glyph data
5. `pokered_renderer::embedded_font::{draw_glyph, draw_text, fill_tile}` — render functions
6. `pokered_renderer::game_font::GameFont` — optional, for `draw_gb_tile`

Everything else in pokered-renderer (4.3MB worth of code) is dead weight for the wasm preview.

---

## Binary Size Analysis

| Artifact | Size | Key Contributors |
|----------|------|-----------------|
| `libpokered_data.rlib` | 8.5MB | Serde serialization code, all 151 species data, 248 map headers |
| `libpokered_core.rlib` | 13MB | Game logic, battle engine, overworld, boa_engine |
| `libpokered_renderer.rlib` | 4.3MB | FrameBuffer, tiles, text, + unused: wgpu(39MB rlib), winit(13MB rlib), image(15MB rlib) |
| `libpokered_ui.rlib` | 508KB | Painter trait, FrameBufferPainter, 15 menu draw functions |
| `pokered_web.wasm` (debug) | 149MB | Full game including wgpu, winit, boa_engine |
| **Projected `pokered-ui-preview.wasm` (release + wasm-opt)** | **<1MB** (est.) | Only framebuffer modules + embedded font data + menu code |

With the `framebuffer` feature split removing wgpu/winit/pixels/image/boa_engine from the wasm build, the resulting binary should be well under the 1MB target.

---

## Key Decisions from Audit

1. **Crate split NOT needed**: The existing module structure is cleanly separable — 15 pure-CPU modules vs 5 GPU-dependent modules. A feature gate is sufficient.

2. **`game_font` bridging is the hardest part**: `GameFont` is used by `FrameBufferPainter` but currently loads via `ResourceManager`. Needs a `from_tilesets()` constructor that accepts pre-loaded data. This is ~20 lines of new code.

3. **`embedded-scripts` feature is the path of least resistance for wasm32**: The `pokered-core` `load_auto` issue has a simple fix (add wasm32 stub), but enabling `embedded-scripts` for wasm32 builds is more robust. The `pokered-ui-preview` crate can simply forward this feature.

4. **No `pokered-ui` changes needed**: `FrameBufferPainter` and the 15 menu modules are already wasm-clean. The only change in `pokered-ui` will be updating its `pokered-renderer` dependency to use `default-features = false`.

---

## Open Questions

1. **Should `embedded-scripts` be the default for wasm32 builds?** Currently it's opt-in. Making it default for `cfg(target_arch = "wasm32")` would eliminate the `load_auto` cfg gap for all wasm consumers.

2. **Should `game_font` live in its own crate?** It's used by both `pokered-ui` (FrameBufferPainter) and `pokered-renderer` (full game rendering). Splitting it into `pokered-font-data` would make the dependency cleaner. **Verdict**: Not needed for Stage 2 — the `from_tilesets()` constructor is sufficient.

3. **Font data for wasm preview**: `game_font::GameFont` needs tile data to render GB-specific glyphs (e.g., PKMN symbol, HP bar tiles). Options:
   - Embed font PNG as `include_bytes!` in `embedded.rs` and decode to `TileSet` at runtime
   - Hardcode the font tiles as Rust arrays (similar to `embedded_font.rs` pattern)
   - **Recommendation**: Use `embedded.rs` pattern — already exists, just needs font PNGs added to embedded assets

4. **`image` crate in `FrameBuffer::save_png`**: Already cfg-gated, but the `image` crate is still a dependency. After feature split, `save_png` will only be available under `gpu` feature. Should there be a wasm-safe PNG encoder behind `framebuffer`? **Verdict**: Not needed for Stage 2 — the preview returns raw RGBA bytes to JavaScript, not PNG files.

5. **Test impact**: Several renderer tests use `std::path::PathBuf` and `winit::keyboard::KeyCode`. These need `#[cfg(feature = "gpu")]` gating in tests.rs. Estimate: 10-20 test functions affected.

---

## Estimated Effort (Revised from Plan)

| Stage | Original Estimate | Revised |
|-------|-------------------|---------|
| Stage 2.1 (preview crate creation) | 0.5 day | 0.5 day (unchanged) |
| Stage 2.2 pre-reqs (feature gating in renderer) | 0.5-2 days | **3.5 hours** (no crate split needed) |
| Stage 2.3 (mock states) | 1 day | 1 day |
| Stage 2.4 (runtime layout parser) | 0.5 day | 0.5 day |
| Stage 2.5 (wasm-bindgen API) | 0.5 day | 0.5 day |
| Stage 2.6 (vite integration) | 0.5 day | 0.5 day |
| Stage 2.7 (exit gate verification) | 0.5 day | 0.5 day |
| **Total Stage 2** | **~5-7 days** | **~4.5 days** |

The audit confirms the optimistic case from the plan: no crate split needed, well-structured code, feature-gating is the right approach.

---

## Verification Commands (for future reference)

```bash
# After pre-reqs are applied, these commands should all pass:
cd /Users/liuyanghe02/develop/pokered/workspace

# 1. Native build still works
cargo build --workspace

# 2. All tests still pass
cargo test --workspace

# 3. Wasm build of renderer with framebuffer only
cargo build -p pokered-renderer \
  --target wasm32-unknown-unknown \
  --no-default-features --features framebuffer

# 4. No GPU/native crates in wasm dependency tree
cargo tree -p pokered-renderer \
  --target wasm32-unknown-unknown \
  --no-default-features --features framebuffer \
  | grep -E "wgpu|winit|pixels|image|mio|tokio"
# Expected: no output

# 5. Wasm build of pokered-ui with framebuffer only
cargo build -p pokered-ui \
  --target wasm32-unknown-unknown \
  --no-default-features

# 6. pokered-data is wasm-clean
cargo build -p pokered-data --target wasm32-unknown-unknown
```
