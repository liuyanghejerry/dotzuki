# Risks and Decisions

This document captures key decisions made during planning, deviations from the oracle's original design, and active risks the implementation needs to manage.

## Deviations from Oracle Design

### 1. Reuse `FrameBufferPainter` Instead of New `PreviewPainter`

**Oracle proposed**: A new `PreviewPainter` in `pokered-ui-preview` that simplifies rendering for the editor.

**We chose**: Reuse the existing `FrameBufferPainter` from `crates/pokered-ui/src/backends/framebuffer.rs`.

**Why**: `FrameBufferPainter` already exists and uses `pokered_renderer::embedded_font` glyphs — the same glyphs the actual game uses. A separate `PreviewPainter` would diverge from game rendering, defeating the point of "WYSIWYG matches game". Discovery made during exploration phase.

**Risk if wrong**: `FrameBufferPainter` may have native-only dependencies we haven't audited. **Mitigation**: Step 2.2 (wasm-compat audit) is mandatory and explicitly checks this.

### 2. Layouts Passed as Parameters, Not Imported as Globals

**Oracle proposed (implicitly)**: Menu code does `use pokered_data::ui_layout::MART_LAYOUT;` and references the static directly.

**We chose**: Menu draw functions take `layout: &MartXxx` as a parameter; callers pass either the compile-time static (game) or a runtime-parsed struct (editor preview).

**Why**: The editor must inject in-progress edits into the wasm preview. If menu code reaches into a `static`, the preview can't override it without unsafe global mutation. Parameterization keeps menus pure functions.

**Cost**: Every caller (`pokered-core` state machines, etc.) needs updating to pass layouts through. This is mechanical but touches many files.

### 3. `schema_version` Mandatory in Every JSON File

**Oracle proposed**: Optional version field, default to v1.

**We chose**: Required field; `build.rs` panics on missing or unknown versions.

**Why**: Future schema migrations are inevitable. Forcing the version to be present from day 1 means we can detect old files cleanly later. Cost is one line per file. Benefit is permanent — no "did anyone update this old layout?" guessing.

### 4. No `code_override` Escape Hatch in Schema

**Oracle proposed**: Allow JSON to flag a layout region as "code-controlled" so weird cases don't have to go in JSON.

**We chose**: No escape hatch. If the schema can't express a pattern, extend the schema.

**Why**: Escape hatches metastasize. The first one is justified, the tenth ruins the system. The whole point of externalization is that the editor can edit *everything* visible in a menu. If 5% of menus have `code_override` regions, the editor is unreliable. Better to face the schema-design pain upfront.

**Risk if wrong**: Some menu pattern proves genuinely hard to schematize, slowing Stage 1. **Mitigation**: Step 1.5 (mart.rs migration) is the canary — if mart can't be expressed cleanly, redesign schema before propagating.

### 5. `Cow<'static, str>` for Layout String Fields

**Discovered during Stage 2 planning** (step 2.4). Originally planned `&'static str`.

**Why changed**: Runtime parser needs to construct layouts from heap strings. `&'static` forces either `Box::leak` (memory leak per edit) or a duplicate type system (complexity explosion). `Cow<'static, str>` lets compile-time codegen emit `Cow::Borrowed("BUY")` (zero-cost) and runtime parser emit `Cow::Owned(string)` — same type, both work.

**Cost**: Layout structs lose `Copy`, become `Clone`. Menu code uses `&layout.box.labels[0]` instead of `let label = layout.box.labels[0]`. Trivial change.

**Plan files updated**: Note must be added to `stage1/02-rust-types.md` to use `Cow`. Codegen in `stage1/03-codegen.md` must emit `Cow::Borrowed(...)`.

## Active Risks

### R1: `pokered-renderer` May Not Be Wasm-Compatible

**Severity**: High. Blocks Stage 2 entirely.

**Probability**: Medium. The rendering modules (`framebuffer`, `embedded_font`, `text_renderer`) are likely pure CPU. The pipeline modules (`viewport`, `window_layer`, `transition`, `battle_*`) probably use wgpu.

**Mitigation**:
- Step 2.2 audit is mandatory and time-boxed (2 days)
- Feature-split (`cpu`/`gpu`) is the first-line fix
- Crate split (`renderer-core` / `renderer-gpu`) is the fallback if features can't cleanly partition the code
- Worst case: 1 week added to Stage 2

**Detection**: `cargo check -p pokered-renderer --target wasm32-unknown-unknown` fails or pulls in wgpu.

### R2: Migration Breaks Tests

**Severity**: High. Project-wide test failures block all PRs.

**Probability**: Low. The migration only changes how data is supplied to draw functions; the data values themselves are extracted from existing source. Tests assert on rendered output — if extraction is correct, tests stay green.

**Mitigation**:
- Step 1.4 (main.rs) is the validation step; if main.rs tests fail, redesign the parameter passing approach before touching mart
- Step 1.5 (mart.rs) is the stress test; if mart breaks, fix before scaling
- Test assertions are **never** modified — only the function signatures (adding a layout parameter)
- CI gate (step 1.7) blocks merging if any test diverges

**Detection**: `cargo test --workspace` fails after migration of any menu.

### R3: Schema Can't Express Some Menu Pattern

**Severity**: Medium. Causes schema rework mid-Stage 1.

**Probability**: Medium. We know about variable-position cancel rows (mart), keyboard grids (naming), multi-page layouts (stats). There may be more.

**Mitigation**:
- Stage 1.5 (mart) and 1.6 (stats, naming) explicitly call out tricky cases
- When discovered, **stop** that menu's migration, extend the schema, re-run seed for affected files, resume
- Do not work around with hardcoded code — that just defers the problem

**Detection**: Migration of a menu requires either keeping `TileRect::new(...)` literals or extracting derived formulas to JSON (which they shouldn't be — derived stays in code).

### R4: Wasm Binary Too Large

**Severity**: Low. Editor still works, just slow first load.

**Probability**: Low. Game Boy fonts and tile data are tiny (~10KB). The bulk of the binary is `pokered-ui` + `pokered-renderer` code (~500KB likely).

**Mitigation**:
- `wasm-opt -Oz` reduces binary by 30-50%
- Default-feature gating in `pokered-renderer` (cpu-only for wasm) excludes wgpu (~2MB) cleanly
- If still > 1MB compressed: lazy-load with code splitting

**Detection**: CI check on binary size in step 2.6.

### R5: Editor UX Doesn't Justify the Effort

**Severity**: Medium. Spent ~10 days on Stage 1+2, designer doesn't actually use the editor.

**Probability**: Low if there's an actual designer asking for it. High if this is speculative tooling.

**Mitigation**:
- Validate before Stage 3: have a designer try Stage 2's preview with hand-edited JSON
- If they don't find it useful, freeze at end of Stage 2 (the JSON externalization is still valuable for code clarity even without an editor)

**Detection**: Stage 3 design discussions reveal designers don't want what we're planning to build.

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| Planning | Path A (externalize + wasm preview) over Path B (re-impl in Canvas) or Path C (screenshot annotation) | A is the only path that guarantees byte-identical preview-to-game |
| Planning | Reuse `FrameBufferPainter` | Discovered to already exist; avoids divergence |
| Planning | Layout as parameter, not global static | Editor needs to inject runtime layouts |
| Planning | `schema_version: 1` mandatory | Future migration path |
| Planning | No `code_override` escape hatch | Avoid system erosion |
| Planning | One JSON file per menu module | Manageable file size, clear ownership |
| Planning | Python seed script (one-shot, then deleted) | Bootstrap pain reduction; JSON is canonical after |
| Planning | `Cow<'static, str>` for layout strings | Same type works for compile-time and runtime construction |
| Planning | Stage 0 vertical slice mandatory (mart::draw_main_menu) | De-risk pipeline before scaling to all 15 menus |
| Planning | Defer Stage 3 detailed planning until Stage 2 ships | Need real preview to design editor UX |
| Post-momus | `BoxDef.dynamic_height: { extra_per_row }` for boxes that resize with list length | Mart, bag, etc. resize box height to fit items; row count supplied by code per render |
| Post-momus | WASM-compat audit (step 2.2) is MANDATORY and executes BEFORE step 2.1 | Step 2.1 `Cargo.toml` references the `framebuffer` feature that 2.2 must produce |
| Post-momus | Byte-identity baseline harness uses native `pokered-ui` integration tests, not `pokered-emu` | Stage 2 claim is "JSON externalization is a pure refactor", not "matches GBA hardware"; capture from same code path that game uses |
| Post-momus | `pokered-renderer` features named `framebuffer` (CPU, default-on) and `gpu` (native-only); `pokered-ui-preview` uses `default-features = false, features = ["framebuffer"]` | Naming is a stable contract — preview crate's Cargo.toml depends on it |
| Post-momus | `FrameBufferPainter` is borrowed-style (`<'fb>`); preview owns `FrameBuffer` and constructs painter per render | Verified upstream API; self-referential lifetime in `PreviewSession` is impossible without unsafe |
| Post-verify | Move `InkColor`, `TileRect`, `BracketSides` from `pokered-ui::engine` → `pokered-data::ui_layout::types` | `pokered-ui` already depends on `pokered-data`; reverse dep would be circular. `pokered-ui::engine` re-exports them for back-compat. |

## Stage Gate Summary

| Stage | Exit Gate | Effort | Blocking Risks |
|-------|-----------|--------|----------------|
| 0 (vertical slice) | mart::draw_main_menu end-to-end through schema → codegen → migrated function → green test | 1-2 days | None (but reveals others) |
| 1 (data externalization) | All 15 menus migrated, 0 hardcoded layouts, all 2,446 tests green | ~6-8 days (revised: includes 2-4 day seeding) | R2, R3 |
| 2 (wasm preview) | Editor renders any screen byte-identical to baselines (per 2.2b harness) | ~5-7 days concentrated + ~3-4 days fixture creation spread | R1, R4 |
| 3 (editor UI) | Designer edits visually, saves to JSON, game picks up changes | ~2 weeks | R5 |
| **Total** | Editor in production use | **~4-5 weeks** | — |

## When to Revisit This Document

- After each stage exit gate: update Decisions Log, re-evaluate active risks, retire mitigated risks
- When any decision proves wrong in implementation: log the reversal here with rationale
- Before starting Stage 3: re-confirm Stage 3 is still wanted given Stage 2's actual preview behavior
