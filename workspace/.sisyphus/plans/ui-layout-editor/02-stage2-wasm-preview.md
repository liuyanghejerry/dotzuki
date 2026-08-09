# Stage 2 — WASM Preview Crate

## Goal

Compile `pokered-ui` + `pokered-renderer` to WebAssembly so the Vue editor can render any menu **byte-identically** to the actual game, given a layout JSON. The preview is the editor's visual feedback loop.

## Architecture

```
                        ┌────────────────────────────────────────────┐
                        │           Vue editor (browser)             │
                        │  ┌──────────────────┐ ┌─────────────────┐  │
                        │  │ Layout JSON edit │ │ Mock state pick │  │
                        │  └────────┬─────────┘ └────────┬────────┘  │
                        │           │ set_layout(json)   │ set_state │
                        │           ▼                    ▼            │
                        │       ┌──────────────────────────────┐     │
                        │       │   pokered-ui-preview.wasm    │     │
                        │       │  (Rust crate, wasm-bindgen)  │     │
                        │       │                              │     │
                        │       │  - parses JSON layout        │     │
                        │       │  - dispatches to draw_X()    │     │
                        │       │  - uses FrameBufferPainter   │     │
                        │       │    (existing!)               │     │
                        │       │  - returns RGBA pixel buffer │     │
                        │       └────────────┬─────────────────┘     │
                        │                    ▼                         │
                        │              <canvas> blit                   │
                        └────────────────────────────────────────────┘
```

## Why This Works (Key Insight)

`crates/pokered-ui/src/backends/framebuffer.rs` already implements `FrameBufferPainter` using `pokered_renderer::embedded_font` glyphs. This painter:

- Renders into a `Vec<u8>` RGBA buffer (no GPU dependency)
- Uses the **same** glyph data the game uses
- Produces output that matches game rendering tile-for-tile, pixel-for-pixel

So the wasm preview just needs to:
1. Parse layout JSON into the same types `pokered-data` exposes
2. Call existing `menus::draw_X(state, layout, ui)` with `Ui<FrameBufferPainter>`
3. Return the framebuffer to JavaScript

**No new rendering code is needed.** This is the single biggest simplification vs. the original oracle design (which proposed a separate `PreviewPainter`).

## Substeps

| Step | File | Purpose |
|------|------|---------|
| 2.1 | `stage2/01-crate-setup.md` | Create `pokered-ui-preview` crate with wasm-bindgen plumbing |
| 2.2 | `stage2/02-wasm-compat-audit.md` | Verify `pokered-renderer` modules are wasm-safe (no wgpu, no native I/O) |
| 2.3 | `stage2/03-mock-states.md` | Define mock states for each menu (sample bag contents, party, money, etc.) |
| 2.4 | `stage2/04-runtime-layout-parser.md` | JSON-to-layout-struct parser (used by editor's set_layout) |
| 2.5 | `stage2/05-wasm-bindgen-api.md` | Public JS API: render(), set_layout(), set_state(), list_screens() |
| 2.6 | `stage2/06-vite-integration.md` | Build pipeline: wasm-pack → npm package → Vite import |
| 2.7 | `stage2/07-stage2-exit-gate.md` | Acceptance: editor displays default-state preview of all migrated screens |

## What Stage 2 Does NOT Include

- Editor UI (drag handles, numeric inputs) — Stage 3
- Persisting edits back to JSON files — Stage 3
- Undo/redo — Stage 3
- The wasm preview is a **pure render service** in Stage 2

## Critical Constraints

- **Byte-identical to game**: if a glyph differs by one pixel, the editor lies to the designer
- **Wasm-compatible only**: no `std::fs`, no `std::time::Instant` in render path, no wgpu/winit
- **Synchronous render**: `render(state, layout) → bytes` — no async, no message passing inside wasm
- **Small wasm binary**: target < 1 MB compressed (font data is the bulk; glyphs are tiny)

## Risks Specific to Stage 2

| Risk | Mitigation |
|------|------------|
| `pokered-renderer` pulls in wgpu transitively | Audit (step 2.2); split into `pokered-renderer-core` (pure CPU) + `pokered-renderer-gpu` if needed |
| `FrameBufferPainter` uses native-only deps (e.g. `image` crate) | Verify in 2.2; replace with manual RGBA writes if necessary |
| wasm binary too large for fast iteration | Use `wasm-opt -Oz`; lazy-load font data; report binary size in CI |
| JSON parse cost dominates render time | Parse once on `set_layout`, cache typed struct, render uses cached version |
| Mock states drift from real game data shapes | Generate mock states by sampling real save files in `pokered-emu` (Stage 2.3) |

## Stage 2 Exit Gate (preview ready for editor consumption)

- [ ] `wasm-pack build crates/pokered-ui-preview --target web` succeeds
- [ ] Resulting wasm binary < 1 MB compressed
- [ ] Headless integration test: load layout, render, compare RGBA bytes against captured game framebuffer for the same screen → 100% match
- [ ] Vue dev server can `import init from 'pokered-ui-preview'` and call `render()` → canvas displays correct image
- [ ] All 15 menus + their variants render correctly using their default mock states
- [ ] Calling `set_layout(modified_json)` re-renders with the modification visible
- [ ] No wgpu/winit/file-system code in the wasm dependency tree (verified via `cargo tree`)

## Effort Sizing

| Substep | Effort |
|---------|--------|
| 2.1 crate setup | 0.5 day |
| 2.2 wasm-compat audit | 0.5 day (could expand to 2 days if `pokered-renderer` needs splitting) |
| 2.3 mock states | 1 day |
| 2.4 runtime layout parser | 0.5 day |
| 2.5 wasm-bindgen API | 0.5 day |
| 2.6 vite integration | 0.5 day |
| 2.7 exit gate verification | 0.5 day |
| **Total** | **~4 days** |

Plus up to 2 days slack if the wasm-compat audit reveals `pokered-renderer` needs to be split.
