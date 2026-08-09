# UI Layout Editor — Overview

## Goal

Make complex menu/dialog layouts (mart, bag, party, stats, naming, battle, dialog) editable from the `tools/game-editor` Vue web app, with **WYSIWYG real-time preview** powered by the same Rust typesetting engine the game uses.

The user gets:
- Drag handles to resize/move boxes
- Numeric x/y/w/h inputs for precision tuning
- Switchable mock states (e.g. "0 items in bag" vs "full bag")
- Undo/redo + diff view

The game gets:
- Same typesetting code, no fork
- All 2,446 existing tests stay green (byte-for-byte behavior preservation)

## Architecture (Path A — confirmed by user)

```
                       ┌─────────────────────────┐
JSON files in repo ──► │ build.rs (pokered-data) │ ──► generated Rust statics
crates/pokered-data/   └─────────────────────────┘            │
  ui_layouts/*.json                                            ▼
  ui_mock_states/*.json                            menu draw_*() functions
       │                                              (read layout from statics)
       │                                                       │
       │                                                       ▼
       │                                          ┌────────────────────────┐
       │                                          │   FrameBufferPainter   │ (already exists)
       │                                          │   in pokered-ui        │
       │                                          └────────────────────────┘
       │                                                       │
       │                                                       ▼
       │                          ┌─────────────────────────────────────────┐
       └──────────────────► HTTP  │  pokered-ui-preview (NEW wasm crate)    │
       fetched/saved by editor    │   wasm-bindgen exports for live render  │
                                  └─────────────────────────────────────────┘
                                                               │ Vec<u8> RGBA
                                                               ▼
                                                       Vue editor canvas
```

## Stage Breakdown

| Stage | Scope | Plan File |
|-------|-------|-----------|
| 1 | Externalize 15 menu layouts to JSON + build.rs codegen + migrate menu modules | [`01-stage1-data-externalization.md`](./01-stage1-data-externalization.md) |
| 2 | New `pokered-ui-preview` wasm crate using existing `FrameBufferPainter` | [`02-stage2-wasm-preview.md`](./02-stage2-wasm-preview.md) |
| 3 | Vue editor activity (drag/resize, numeric inputs, mock state switcher, undo/redo) | [`03-stage3-editor-ui.md`](./03-stage3-editor-ui.md) — separate planning round |

Stages 1 and 2 are the engineering foundation. Stage 3 is UX work that depends on 1+2 being stable.

## Top-Level Verification Gates

Each stage MUST satisfy ALL of these before being considered complete:

| Stage | Gate | Command |
|-------|------|---------|
| 1 | All 2,446 tests pass with zero assertion changes | `cargo test --workspace` |
| 1 | `pokered-data` builds and emits `ui_layouts_gen.rs` | `cargo build -p pokered-data && ls target/debug/build/pokered-data-*/out/ui_layouts_gen.rs` |
| 1 | All 15 menu modules read from layout statics (no hardcoded `TileRect::new`) | `grep -rn 'TileRect::new' crates/pokered-ui/src/menus/` returns 0 results |
| 2 | wasm crate compiles | `cargo build -p pokered-ui-preview --target wasm32-unknown-unknown --release` |
| 2 | E2E render of mart main menu produces non-blank framebuffer | Rust unit test in `pokered-ui-preview` |
| 2 | All 15 screens render without panic with default mock states | Rust unit test loops over 15 screens |
| 2 | wasm binary <2MB after `wasm-opt -Oz` | `ls -lh crates/pokered-ui-preview/pkg/*.wasm` |

## What's NOT in This Plan

- Visual regression CI (PNG diff) — out of scope, optional future
- Layout hot-reload to a running game instance — out of scope, optional future
- Stage 3 (Vue UI) — separate plan after 1+2 land

## De-Risking Path (MANDATORY before full migration)

Before migrating all 15 menus, prove the **entire vertical slice** end-to-end with **just `mart.rs::draw_main_menu`**:

1. Create `ui_layouts/mart.json` with only the `main_menu` variant
2. Add codegen for that one variant
3. Migrate `mart.rs::draw_main_menu` only (revert all other changes)
4. Verify `cargo test -p pokered-ui` still passes
5. Skeleton `pokered-ui-preview` crate, render mart main_menu via `FrameBufferPainter`
6. Save framebuffer as PNG, eyeball it
7. Build to wasm32, load in a 50-line HTML page, verify canvas shows the menu

If steps 1–7 work cleanly, proceed to full Stage 1. If anything is gnarly, redesign before scaling up.

This vertical slice is **Stage 0** and is its own gate before Stages 1–2 begin in earnest.

## Source of Truth

- All design decisions: this folder
- All risks/deviations from oracle: [`04-risks-and-decisions.md`](./04-risks-and-decisions.md)
- Original oracle design doc (raw): session `ses_1ee338b80ffechU2kt7lbBF4im`, retrieved 2026-05-10
