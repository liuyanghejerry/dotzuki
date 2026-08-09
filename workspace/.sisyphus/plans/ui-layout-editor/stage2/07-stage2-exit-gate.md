# Step 2.7 — Stage 2 Exit Gate

Stage 2 ships when the editor can render any migrated screen pixel-perfectly via wasm. No editing UI yet — that's Stage 3 — but the rendering substrate must be solid before building drag handles on top.

## Verification Checklist

### Build & Binary

- [ ] `cargo build --workspace` green (native)
- [ ] `cargo check -p pokered-ui-preview --target wasm32-unknown-unknown` green
- [ ] `wasm-pack build crates/pokered-ui-preview --target web --release` succeeds
- [ ] Wasm binary < 1 MB compressed (gzip) — measured in CI
- [ ] `cargo tree -p pokered-ui-preview --target wasm32-unknown-unknown` contains no `wgpu`, `winit`, `tokio`, native `image`, or `*-sys` crates

### API Surface

- [ ] `PreviewSession` exposes: `new`, `list_screens`, `set_screen`, `get_layout_json`, `set_layout`, `list_mock_states`, `set_mock_state`, `set_state`, `render`, `width`, `height`, `get_schema`
- [ ] All methods have `///` doc comments → reflected in generated `.d.ts` TypeScript types
- [ ] All fallible methods return readable error strings (no `unwrap`/`panic` in API path)

### Functional

- [ ] Construct `PreviewSession`, call `set_screen("mart")`, call `render()` → returns 92,160 bytes (160×144×4)
- [ ] Pixel buffer contains non-zero data (not all-black, not all-white) for every migrated screen
- [ ] Calling `set_layout(modified_json)` causes the next `render()` to reflect the modification
- [ ] Calling `set_mock_state("buy_long_list")` causes the next `render()` to show 8 items instead of 3
- [ ] Calling `set_layout("not json")` returns a JS error with readable message, does not crash session

### Byte-Identity (Critical)

This is the **central correctness claim** of Stage 2: the wasm preview must produce **byte-identical output** to what the game's `menus::*::draw_*` functions produce when called through `FrameBufferPainter` with the same mock state and layout JSON.

> **Post-momus S2 fix**: the original draft proposed capturing baselines from `pokered-emu`. That is over-claim — Stage 2's testable proposition is **"the JSON externalization is a pure refactor that does not alter pixels"**, not "the rewrite matches Game Boy hardware." The capture mechanism uses native `pokered-ui` integration tests as the source of truth. See **`02b-capture-baselines.md`** for the full harness design.

Concrete commands the gate runs:

```bash
# 1. Validate baseline fixtures exist + are correctly sized (92160 bytes each)
cargo test -p pokered-ui --test baseline_capture

# 2. Preview output matches every baseline byte-for-byte
cargo test -p pokered-ui-preview --test byte_identity

# 3. All existing tests still pass — externalization didn't break anything
cargo test --workspace
```

All three green = byte-identity gate passes. Any single byte mismatch fails the gate.

If the comparison test fails, the diff harness (defined in 2.2b) writes:
- `target/diffs/<name>.actual.png` — preview's render
- `target/diffs/<name>.expected.png` — captured baseline
- `target/diffs/<name>.diff.png` — pixels differing, highlighted in red

Use these to root-cause:
- **Off by a few pixels in glyphs** → font module not actually shared (regression in `embedded_font` reuse)
- **Off in box borders** → `FrameBufferPainter` and game renderer disagree on how to draw boxes (split brain — fix root cause)
- **Off in entire region** → mock state in preview test doesn't match what was used during capture
- **Coordinates shifted by N tiles** → JSON value diverged from original literal during step 1.1 seeding

A single pixel difference fails the gate. The whole point of reusing `FrameBufferPainter` is to eliminate this class of bug.

### Editor Integration Smoke Test

- [ ] Vue editor dev server starts: `cd tools/game-editor && npm run dev`
- [ ] Hardcoded test page loads `pokered-ui-preview`, calls `render()` for each screen, blits to `<canvas>` → developer visually inspects all screens look correct
- [ ] No browser console errors (no MIME type warnings, no async init failures, no out-of-memory)
- [ ] Production build works: `npm run build` produces `dist/` that loads correctly when served statically

### Documentation

- [ ] `crates/pokered-ui-preview/README.md` documents:
  - Crate purpose
  - How to build (`make wasm-preview`)
  - JS API surface (link to `.d.ts`)
  - Hot reload workflow for developers
- [ ] Top-level README updated with reference to Stage 2 deliverables

## Performance Targets

- [ ] `render()` for typical screen: < 16ms in browser (60fps target)
- [ ] `set_layout(json)`: < 5ms for typical layout JSON
- [ ] First `render()` after `init()`: < 100ms (wasm warmup acceptable)

Profile in Chrome DevTools. If `render()` is slow:
- Check if glyph rendering dominates (expected — it's the bulk of the work)
- Avoid re-rendering when state/layout unchanged (memoize on session)

## Stage 2 Done When...

A developer can:
1. Open `tools/game-editor` in a browser
2. Choose any of the 15 migrated screens from a dropdown
3. Choose any mock state for that screen
4. See it rendered as an upscaled 160×144 canvas
5. Paste modified layout JSON into a textarea, see preview update in < 100ms

That's the prerequisite for Stage 3 (which adds drag handles, numeric inputs, save back to file).

## Stage 2 Effort Total

| Substep | Effort |
|---------|--------|
| 2.1 crate setup | 1 day (revised: borrowed-painter wiring) |
| 2.2 wasm-compat audit | 0.5–2 days (high variance, MANDATORY first) |
| 2.2b baseline capture harness | 0.5 day scaffolding + ~3-4 days of fixtures spread across migrations |
| 2.3 mock states | 1 day |
| 2.4 runtime parser | 0.5–1.5 days |
| 2.5 wasm-bindgen API | 0.5 day |
| 2.6 vite integration | 0.5 day |
| 2.7 exit gate verification | 0.5 day |
| **Total (concentrated work)** | **~5–7 days** |
| **Total (incl. fixture creation spread across stages)** | **~8–11 days** |

Wide range driven by audit risk (2.2). If the renderer needs splitting, add 1-2 days. Fixture-creation effort is spread across Stage 1 migrations (one screen at a time), not concentrated.

## Hand-Off to Stage 3

Once Stage 2 passes the gate, the editor team has everything needed to start Stage 3:

- A wasm package with stable API (`PreviewSession`)
- TypeScript types for the API
- Schema descriptor (`get_schema()`) telling the editor what fields to expose as form controls
- Mock state list per screen for the variant picker
- Pixel-perfect rendering — edits show real game appearance
