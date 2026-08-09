# Step 2.2b — Byte-Identity Baseline Capture Harness

> **Post-momus S2 fix**: The Stage 2 exit gate ("preview matches game byte-for-byte") was originally aspirational without a concrete capture mechanism. This step defines the harness that produces those baseline RGBA buffers and the diff tool that compares preview output against them.

## Goal

Produce, for every (screen, variant, mock_state) triple, a canonical 92160-byte RGBA buffer that represents "the game's correct rendering" — captured by running the actual game's menu draw functions through `FrameBufferPainter` in a native test, with **no editor preview involvement**. The wasm preview's `render()` output must match these baselines byte-for-byte.

## Why "Match the Game" Means Capture-Based, Not Pixel-Compare-Live

Running the game itself is too heavy to invoke from a fast diff loop, and the game's rendering involves frame timing, audio, and input that the preview doesn't. Instead:

1. **Capture once**: write a native Rust integration test that calls each `menus::*::draw_*` function through `FrameBufferPainter` with a deterministic mock state and saves the resulting `FrameBuffer.data` as a binary fixture.
2. **Compare often**: the wasm preview crate has an integration test that calls the **same** draw function through the **same** painter with the **same** mock state and compares against the saved fixture.

Because both paths use the same underlying `pokered-ui::menus::*` code and the same `FrameBufferPainter`, the only thing that can differ is the `state` and `layout` arguments. If those match, the bytes match.

> Note: this is not "comparing preview against running the GBA emulator." Stage 2's identity claim is **"preview renders identically to what `menus::*::draw_*` produces today, given the same layout JSON and mock state"** — i.e., the JSON externalization is a pure refactor that does not alter pixels. That is the testable proposition; do not over-claim.

## Crate Layout

```
crates/pokered-ui/
├── tests/
│   └── baseline_capture.rs         # writes fixtures to crates/pokered-ui/tests/baselines/
└── tests/baselines/
    ├── mart__main_menu__default.bin     # 92160 bytes RGBA
    ├── mart__main_menu__cursor_at_buy.bin
    ├── start__start_menu__default.bin
    └── ...                              # one file per (screen, variant, state)

crates/pokered-ui-preview/
└── tests/
    └── byte_identity.rs            # reads fixtures, runs preview, asserts equality
```

## Capture Test (`crates/pokered-ui/tests/baseline_capture.rs`)

```rust
use std::path::PathBuf;
use pokered_renderer::{FrameBuffer, Rgba};
use pokered_ui::backends::framebuffer::FrameBufferPainter;
use pokered_ui::engine::Ui;
use pokered_ui::menus;

const BASELINE_DIR: &str = "tests/baselines";

fn baseline_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join(BASELINE_DIR)
        .join(format!("{name}.bin"))
}

fn render_to_bytes<F>(draw: F) -> Vec<u8>
where
    F: FnOnce(&mut Ui<FrameBufferPainter>),
{
    let mut fb = FrameBuffer::new(Rgba::WHITE);
    {
        let painter = FrameBufferPainter::new(&mut fb);
        let mut ui = Ui::new(painter);
        draw(&mut ui);
    }
    fb.data
}

/// Run with `cargo test -p pokered-ui --test baseline_capture -- --ignored capture`
/// to (re)write fixtures. Default test run only verifies fixtures exist + are 92160 bytes.
#[test]
#[ignore = "writes fixtures; run explicitly to regenerate"]
fn capture_mart_main_menu_default() {
    let layout = &pokered_data::ui_layout::MART_LAYOUT.main_menu;
    let state  = mart_default_state();
    let bytes  = render_to_bytes(|ui| menus::mart::draw_main_menu(&state, layout, ui));
    std::fs::write(baseline_path("mart__main_menu__default"), &bytes).unwrap();
}

#[test]
fn fixture_mart_main_menu_default_is_valid() {
    let p = baseline_path("mart__main_menu__default");
    let bytes = std::fs::read(&p).unwrap_or_else(|e| panic!("missing fixture {}: {}", p.display(), e));
    assert_eq!(bytes.len(), 160 * 144 * 4, "fixture {} is wrong size", p.display());
}

// ... one capture + one validation test per (screen, variant, state)
```

The `#[ignore]` attribute prevents accidental regeneration. Operator runs:

```bash
cargo test -p pokered-ui --test baseline_capture -- --ignored capture
```

after intentional rendering changes. Default `cargo test` only checks fixtures exist and are the right size.

## Comparison Test (`crates/pokered-ui-preview/tests/byte_identity.rs`)

```rust
use std::path::PathBuf;

fn baseline_bytes(name: &str) -> Vec<u8> {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../pokered-ui/tests/baselines")
        .join(format!("{name}.bin"));
    std::fs::read(&p).unwrap_or_else(|e| panic!("missing baseline {}: {}", p.display(), e))
}

#[test]
fn mart_main_menu_default_matches_baseline() {
    let mut session = pokered_ui_preview::PreviewSession::new();
    session.set_screen("mart").unwrap();
    // default state — no override
    let actual = session.render().unwrap();
    let expected = baseline_bytes("mart__main_menu__default");
    assert_eq!(actual.len(), expected.len(), "size mismatch");
    if actual != expected {
        let diff_count = actual.iter().zip(&expected).filter(|(a, e)| a != e).count();
        // Optional: write actual + diff PNG to target/ for inspection
        panic!("byte mismatch: {} bytes differ out of {}", diff_count, actual.len());
    }
}

// ... one test per (screen, variant, state)
```

## State Catalogue

For each screen, define at minimum:
- `default` — fresh state (cursor at 0, no items, fresh save)
- One non-default cursor position (e.g. `cursor_at_buy`)
- One state exercising any conditional rendering (e.g. `with_money` for mart)
- For dynamic_height boxes: one state with a small list, one with a large list

Total: ~3-5 states per screen × 15 screens × ~2-3 variants per screen = **roughly 100-200 baseline fixtures**. Each is 92160 bytes uncompressed; total ~10-20 MB. Acceptable to commit (binary, but stable, and only regenerated on intentional rendering changes).

> Consider gzip-compressing the fixtures (`*.bin.gz`) — RGBA from a low-color UI compresses 10-20×. Decision: commit raw `.bin` first; switch to gzipped if size becomes an issue. Reproducibility wins over space.

## Diff Tooling

When a comparison test fails, dump:
1. `target/diffs/<name>.actual.png` — the preview's output, decoded
2. `target/diffs/<name>.expected.png` — the baseline, decoded
3. `target/diffs/<name>.diff.png` — pixels where they differ, highlighted in red

Add a helper:

```rust
fn dump_diff_artifacts(name: &str, actual: &[u8], expected: &[u8]) {
    use std::io::Write;
    use std::path::PathBuf;
    let dir = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("diffs");
    std::fs::create_dir_all(&dir).ok();
    // Encode actual + expected as PNG via image crate, write to dir.
    // Pixel-by-pixel diff: write a third PNG with non-matching pixels in red.
    // ...
}
```

This makes failures actionable instead of "92160 bytes differ, somewhere."

## Stage 2 Exit Gate Wiring

Step 2.7 (stage 2 exit gate) must require:

```bash
# 1. Baseline fixtures exist and are valid sizes
cargo test -p pokered-ui --test baseline_capture
# 2. Preview matches every baseline byte-for-byte
cargo test -p pokered-ui-preview --test byte_identity
# 3. Existing tests still pass
cargo test --workspace
```

All three green = Stage 2 exit gate passes. Update `07-stage2-exit-gate.md` to reference this step.

## Sequencing

This step (2.2b) executes **after** the first menu has been migrated to use a layout from JSON (post step 1.4 / 1.5 in Stage 1). Order:

1. Stage 1 step 1.4 migrates `menus::main` to consume `pokered_data::ui_layout::MAIN_LAYOUT`.
2. Capture baselines for `main` (write fixtures).
3. Stage 2 step 2.1 + 2.2 + 2.5 implement preview rendering for `main`.
4. Run `byte_identity` for `main` — must pass before claiming Stage 2 vertical slice complete.
5. Repeat 1→4 for each subsequent screen as it's migrated in step 1.5 / 1.6.

> **First-screen vertical slice (Stage 0 + Stage 2 vertical slice combined)**: capture+compare for `main::draw_main_menu` is the smallest unit that exercises the full pipeline end-to-end. This is the early validation gate. If byte-identity fails here, do NOT proceed with migrating other screens until root-caused.

## Effort

- Capture harness scaffolding: 0.5 day
- One baseline + comparison test per screen variant: ~1 hour each, total ~3-4 days for full coverage (parallelizable with migrations)
- Diff tooling + PNG dump: 0.5 day

**Total**: 4-5 days, but spread across Stage 1 + Stage 2 — capture happens as each screen is migrated, not all at once.

## Acceptance

- [ ] `crates/pokered-ui/tests/baseline_capture.rs` exists with at least one capture + one validation test
- [ ] `crates/pokered-ui/tests/baselines/main__main_menu__default.bin` exists, is 92160 bytes
- [ ] `crates/pokered-ui-preview/tests/byte_identity.rs` exists with at least one comparison test
- [ ] `cargo test -p pokered-ui-preview --test byte_identity` passes for the migrated screens
- [ ] Diff tooling dumps PNGs to `target/diffs/` on failure
- [ ] Step 2.7 (stage 2 exit gate) updated to require all three commands above
