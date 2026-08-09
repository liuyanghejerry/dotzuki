# Step 2.2 — WASM Compatibility Audit (MANDATORY, EXECUTE FIRST)

> **Post-momus B2 fix**: This step is **NOT optional** and **NOT contingent on step 2.1 failing**. Execute it BEFORE writing any `pokered-ui-preview` code. The `[features]` split it produces is a **prerequisite** that step 2.1's `Cargo.toml` already references (`features = ["framebuffer"]`). If you skip ahead and step 2.1's `cargo check --target wasm32-unknown-unknown` fails, you will be debugging an ambiguous mix of "is it the new crate?" vs "is it upstream?" — much harder than auditing first.
>
> **Sequencing rule**: 2.2 (audit + feature-gate `pokered-renderer` and `pokered-ui`) → 2.1 (build new crate against the now-clean upstream) → 2.3+ (rest of stage 2).
>
> The plan files are numbered by topical order, not execution order. Read 2.1 first for context (so you understand what the audit needs to enable), but **execute 2.2 first**.

Confirm `pokered-renderer` (and transitively `pokered-ui` + `pokered-data`) can build for `wasm32-unknown-unknown`. This is the **highest-risk item in Stage 2** — if it requires a crate split, that's a 1-2 day side quest before Stage 2 proper begins.

## Why This Matters

The wasm preview reuses `FrameBufferPainter` from `pokered-ui`, which depends on `pokered-renderer::embedded_font` and `pokered-renderer::game_font`. If `pokered-renderer` pulls in wgpu, winit, or any native-only dependency from a path the preview transitively touches, the wasm build will fail or the binary will explode in size (3MB+ baseline wgpu is unacceptable for editor responsiveness).

## Audit Steps

### 1. List actual dependency tree

```bash
cargo tree -p pokered-renderer --target wasm32-unknown-unknown
cargo tree -p pokered-ui      --target wasm32-unknown-unknown
```

Look for any of these in the output:
- `wgpu` / `wgpu-core` / `wgpu-hal`
- `winit`
- `glutin` / `surfman`
- `tokio` (with full features)
- `mio`
- `image` (depends on the file format features enabled)
- Any `*-sys` crate
- Any crate marked `std`-only

### 2. Try a wasm build

```bash
cd crates/pokered-renderer
cargo check --target wasm32-unknown-unknown --no-default-features
cargo check --target wasm32-unknown-unknown                          # default features
```

Capture errors. Common failure modes:

| Error | Cause | Fix |
|-------|-------|-----|
| `failed to find function "..." in module "env"` | Native syscall referenced | Find the offending crate, gate behind `#[cfg(not(target_arch = "wasm32"))]` |
| `the wasm32-unknown-unknown target does not support std::time::Instant` | Time API used | Use `instant` crate or feature-gate timing code |
| `cannot find function clock_gettime` | libc time call | Same as above |
| Compile fails on `wgpu` | GPU code in render path | Split crate (see below) |

### 3. Check `pokered-renderer` features

Look at `crates/pokered-renderer/Cargo.toml`. Likely structure:

```toml
[features]
default = ["framebuffer", "gpu"]
framebuffer = []                  # pure CPU primitives — wasm-safe, default-on
gpu = ["wgpu", "winit"]           # GPU pipeline — opt-out for wasm preview
```

If features aren't structured this way, **structure them this way as part of step 2.2**:

- `framebuffer` (default-on, always available, wasm-safe): `framebuffer`, `embedded_font`, `text_renderer`, `textbox`, `menu`, `game_font`, `tile`, `tilemap`, `palette`, `mon_icon`, `party_hp_bar` — all pure CPU
- `gpu` (default-on for native, must be disabled for wasm): `viewport`, `window`, `window_layer`, `transition`, `battle_*` (if they use wgpu) — rendering pipeline glue

`pokered-ui-preview` then declares (matching step 2.1):
```toml
pokered-renderer = { path = "../pokered-renderer", default-features = false, features = ["framebuffer"] }
```

> **Naming alignment**: this feature is named `framebuffer` (singular concept: "the CPU framebuffer pipeline"), matching what step 2.1's `Cargo.toml` references. Do not rename to `cpu` later — it would silently break the preview crate's `Cargo.toml`.

### 4. Audit each renderer module

From the existing module list:
```
framebuffer, embedded_font, text_renderer, textbox, menu, game_font,
tile, tilemap, window, window_layer, viewport, palette, mon_icon,
party_hp_bar, sprite, battle_*, transition
```

For each, classify:

| Module | Likely Status | Action if Native-Only |
|--------|---------------|------------------------|
| `framebuffer` | Pure CPU (Vec<u8>) | — |
| `embedded_font` | Pure data | — |
| `text_renderer` | Pure CPU | — |
| `textbox` | Pure CPU | — |
| `menu` | Pure CPU | — |
| `game_font` | Pure data | — |
| `tile` | Pure CPU | — |
| `tilemap` | Pure CPU | — |
| `palette` | Pure data | — |
| `mon_icon` | Pure CPU | — |
| `party_hp_bar` | Pure CPU | — |
| `sprite` | Pure CPU (likely) | Verify |
| `window` / `window_layer` | Probably winit-bound | Gate behind `gpu` feature |
| `viewport` | Probably wgpu-bound | Gate behind `gpu` feature |
| `transition` | Likely GPU effects | Gate behind `gpu` feature |
| `battle_*` | Mixed | Audit per-module; CPU parts stay accessible |

For each native-only module, add `#[cfg(feature = "gpu")]` to its `mod` declaration in `lib.rs`.

### 5. Verify `pokered-ui` is wasm-clean

`pokered-ui` should already be mostly wasm-friendly (it's an abstract Painter trait + menus). The only suspect is `backends/`:

```bash
cargo check -p pokered-ui --target wasm32-unknown-unknown --no-default-features
cargo check -p pokered-ui --target wasm32-unknown-unknown    # default features
```

If `backends/` includes a wgpu backend, gate it:
```rust
// crates/pokered-ui/src/backends/mod.rs
pub mod framebuffer;        // always available — used by wasm preview
#[cfg(feature = "gpu")]
pub mod wgpu_backend;
```

### 6. Decision Tree

```
Did wasm build succeed without changes?
├── YES → done; proceed to step 2.3 (mock states)
└── NO → identify offending crate
    ├── Pure CPU module pulled in std::time/fs etc.
    │   └── Feature-gate the offending code path
    ├── wgpu/winit pulled in
    │   └── Add cpu/gpu feature split (see step 4 above)
    └── Third-party crate is wasm-incompatible
        └── Replace with wasm-friendly alternative or vendor a stub
```

## Acceptance

- [ ] `cargo tree -p pokered-renderer --target wasm32-unknown-unknown --no-default-features --features framebuffer` contains no GPU/native crates (no wgpu, winit, glutin, *-sys, mio, full tokio)
- [ ] `cargo check -p pokered-renderer --target wasm32-unknown-unknown --no-default-features --features framebuffer` green
- [ ] `cargo check -p pokered-ui --target wasm32-unknown-unknown --no-default-features` green
- [ ] Native build (`cargo build --workspace`) still green — feature splits did not break game build
- [ ] `cargo test --workspace` — all 2,446 existing tests still pass — feature splits did not break test setup
- [ ] `pokered-renderer/Cargo.toml` has explicit `framebuffer` and `gpu` features with the module assignment from §3 above
- [ ] No `mod` declarations are unconditionally `pub mod` for GPU-only modules — they are gated `#[cfg(feature = "gpu")]`

## Risk: Renderer Needs Major Restructuring

If `pokered-renderer` has tightly coupled GPU/CPU code (e.g. `viewport` reaches into `framebuffer`), a clean feature split may require splitting into two crates:

- `pokered-renderer-core` (pure CPU primitives)
- `pokered-renderer-gpu` (wgpu pipeline, depends on -core)

This is a 1-2 day refactor. **Flag it early** in step 2.2 — don't try to push through. If split is needed:

1. Pause Stage 2 progress
2. Spawn separate task: "Split pokered-renderer into core + gpu crates"
3. Verify game still builds and runs identically after split
4. Resume Stage 2 with `pokered-ui-preview` depending only on `pokered-renderer-core`

## Effort

- Best case (already wasm-clean): 0.5 day audit + verification
- Common case (a few native deps to feature-gate): 1 day
- Worst case (crate split needed): 2-3 days

**Budget 2 days for this step.** It's the single highest-risk item in Stage 2.
