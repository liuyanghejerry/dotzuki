# Step 2.1 — Create `pokered-ui-preview` Crate

New workspace member that exposes Rust UI rendering to JavaScript via wasm-bindgen.

> **Post-momus B3 fix**: `FrameBufferPainter<'fb>` borrows a `FrameBuffer`; it does NOT own one and is NOT constructible from `(width, height)`. The preview crate must own a `FrameBuffer`, lend `&mut fb` into a freshly-constructed painter per render, then read RGBA bytes back out of `fb.data`. The previous draft's `FrameBufferPainter::new(160, 144)` call does not compile.

## Verified Upstream API (read before writing this crate)

```rust
// crates/pokered-renderer/src/lib.rs
pub struct FrameBuffer { pub data: Vec<u8> }   // 160*144*4 = 92160 bytes, public field
impl FrameBuffer {
    pub fn new(clear_color: Rgba) -> Self;
    pub fn clear(&mut self, color: Rgba);
    // ... pixel ops
}
pub const SCREEN_WIDTH: u32 = 160;
pub const SCREEN_HEIGHT: u32 = 144;
pub const FRAMEBUFFER_SIZE: usize = 160 * 144 * 4;

// crates/pokered-ui/src/backends/framebuffer.rs
pub struct FrameBufferPainter<'fb> {
    fb: &'fb mut FrameBuffer,
    game_font: Option<&'fb GameFont>,
}
impl<'fb> FrameBufferPainter<'fb> {
    pub fn new(fb: &'fb mut FrameBuffer) -> Self;
    pub fn with_game_font(fb: &'fb mut FrameBuffer, game_font: Option<&'fb GameFont>) -> Self;
}
```

`FrameBufferPainter` is **borrowed-style**, parameterized over `'fb`. The lifetime of the painter must not exceed the borrow of the `FrameBuffer`. Shape the `PreviewSession` accordingly.

## Crate Layout

```
crates/pokered-ui-preview/
├── Cargo.toml
├── src/
│   ├── lib.rs              # wasm-bindgen API surface
│   ├── parser.rs           # JSON layout → typed struct (used by set_layout)
│   ├── mock_states.rs      # default state per screen
│   ├── render.rs           # screen dispatch: name → draw_X(state, layout, ui)
│   └── error.rs            # thiserror enum, mapped to JsValue
└── tests/
    └── headless.rs         # cargo test (non-wasm) sanity checks
```

## `Cargo.toml`

```toml
[package]
name = "pokered-ui-preview"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
pokered-ui = { path = "../pokered-ui" }
pokered-data = { path = "../pokered-data" }
# wasm-only feature subset of pokered-renderer (see step 2.2):
pokered-renderer = { path = "../pokered-renderer", default-features = false, features = ["framebuffer"] }
wasm-bindgen = "0.2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
thiserror = "1"

[dependencies.web-sys]
version = "0.3"
features = ["console"]

[features]
default = []
console_log = []   # browser-side debug logging via console.log
```

> **Note on `pokered-renderer` features**: this assumes step 2.2 introduces a `framebuffer` feature gating only the wasm-safe parts (FrameBuffer, Rgba, embedded_font, game_font). If the audit finds the current crate already wasm-clean, the `default-features = false, features = ["framebuffer"]` becomes a no-op — leave the line in to enforce the feature contract going forward.

## Workspace `Cargo.toml` Update

```toml
# Cargo.toml (workspace root)
[workspace]
members = [
    # ... existing ...
    "crates/pokered-ui-preview",
]
```

## Skeleton `src/lib.rs` (corrected for borrowed FrameBufferPainter)

```rust
use wasm_bindgen::prelude::*;
use pokered_renderer::{FrameBuffer, Rgba};

mod error;
mod mock_states;
mod parser;
mod render;

use error::PreviewError;

#[wasm_bindgen]
pub struct PreviewSession {
    fb: FrameBuffer,                            // OWNED — painter borrows from this per render
    current_screen: String,
    current_layout_json: String,
    state_overrides: serde_json::Value,
}

#[wasm_bindgen]
impl PreviewSession {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            fb: FrameBuffer::new(Rgba::WHITE),  // matches game's default clear
            current_screen: String::new(),
            current_layout_json: String::new(),
            state_overrides: serde_json::Value::Null,
        }
    }

    pub fn list_screens(&self) -> Vec<JsValue> {
        render::SCREENS.iter().map(|s| JsValue::from_str(s)).collect()
    }

    /// Set which screen to render. Loads the default layout JSON for the screen.
    pub fn set_screen(&mut self, screen: &str) -> Result<(), JsValue> {
        let json = pokered_data::ui_layout::get_layout_json(screen)
            .ok_or_else(|| JsValue::from_str(&format!("unknown screen: {}", screen)))?;
        self.current_screen = screen.to_string();
        self.current_layout_json = json.to_string();
        Ok(())
    }

    /// Override the layout JSON (e.g. live edits from the editor).
    pub fn set_layout(&mut self, json: &str) -> Result<(), JsValue> {
        let _: serde_json::Value = serde_json::from_str(json)
            .map_err(|e| JsValue::from_str(&format!("invalid JSON: {}", e)))?;
        self.current_layout_json = json.to_string();
        Ok(())
    }

    pub fn set_state(&mut self, json: &str) -> Result<(), JsValue> {
        self.state_overrides = serde_json::from_str(json)
            .map_err(|e| JsValue::from_str(&format!("invalid state JSON: {}", e)))?;
        Ok(())
    }

    /// Render to RGBA bytes (160*144*4 = 92160). Clears the framebuffer first.
    pub fn render(&mut self) -> Result<Vec<u8>, JsValue> {
        self.fb.clear(Rgba::WHITE);
        // render_screen borrows &mut self.fb, NOT &mut self, so the rest of self stays accessible.
        render::render_screen(
            &mut self.fb,
            &self.current_screen,
            &self.current_layout_json,
            &self.state_overrides,
        )
        .map_err(|e: PreviewError| JsValue::from_str(&e.to_string()))?;
        Ok(self.fb.data.clone())  // copy the 92160 bytes out for JS consumption
    }

    pub fn width(&self)  -> u32 { pokered_renderer::SCREEN_WIDTH }
    pub fn height(&self) -> u32 { pokered_renderer::SCREEN_HEIGHT }
}
```

## `src/error.rs`

```rust
use thiserror::Error;

#[derive(Debug, Error)]
pub enum PreviewError {
    #[error("unknown screen: {0}")]
    UnknownScreen(String),
    #[error("invalid layout JSON: {0}")]
    InvalidLayout(#[from] serde_json::Error),
    #[error("invalid layout for screen {screen}: {detail}")]
    LayoutMismatch { screen: String, detail: String },
    #[error("variant not found: {0}")]
    UnknownVariant(String),
}
```

## `src/render.rs` Skeleton (corrected)

```rust
use crate::{error::PreviewError, mock_states, parser};
use pokered_renderer::FrameBuffer;
use pokered_ui::{backends::framebuffer::FrameBufferPainter, engine::Ui, menus};

pub static SCREENS: &[&str] = &[
    "main", "mart", "bag", "party", "stats", "naming",
    "options", "save", "start", "dialog",
    "battle_main", "battle_move", "battle_party", "battle_bag", "battle_text",
];   // 15 screens — matches `crates/pokered-ui/src/menus/*.rs` count

pub fn render_screen(
    fb: &mut FrameBuffer,
    screen: &str,
    layout_json: &str,
    state_override: &serde_json::Value,
) -> Result<(), PreviewError> {
    // Painter borrows `fb` for the duration of this function call.
    let painter = FrameBufferPainter::new(fb);
    let mut ui = Ui::new(painter);

    match screen {
        "mart" => {
            let layout = parser::parse_mart_layout(layout_json)?;
            let state = mock_states::mart_state(state_override)?;
            menus::mart::draw_main_menu(&state, &layout.main_menu, &mut ui);
        }
        "main" => {
            let layout = parser::parse_main_layout(layout_json)?;
            let state = mock_states::main_state(state_override)?;
            menus::main::draw_main_menu(&state, &layout.main, &mut ui);
        }
        // ... one arm per screen (15 total, matching SCREENS above)
        other => return Err(PreviewError::UnknownScreen(other.to_string())),
    }

    // `painter` (and `ui`) drops here, releasing the borrow on `fb`.
    Ok(())
}
```

Key points:
- `render_screen` takes `&mut FrameBuffer` (not `&mut PreviewSession`) so the call site retains access to `current_layout_json` etc.
- The painter is constructed inside `render_screen` so its lifetime is bounded by the function call.
- After the function returns, the caller reads `fb.data` (a public `Vec<u8>`) and clones it for JS.

**Do not** try to make `PreviewSession` hold a `FrameBufferPainter<'_>` field — the self-referential lifetime is impossible without `Pin` + `unsafe` and is not worth it. Construct the painter per render.

## Verification Gate

```bash
cd crates/pokered-ui-preview
cargo check                                      # compiles for native target
cargo check --target wasm32-unknown-unknown      # compiles for wasm
cargo test                                       # native sanity tests pass
wasm-pack build --target web                     # produces pkg/ with .wasm + .js
```

All four must succeed. If wasm fails, the issue is upstream in `pokered-renderer` — proceed to step 2.2 (wasm-compat audit, now MANDATORY per momus B2).

## Acceptance

- [ ] Crate added to workspace
- [ ] `cargo check -p pokered-ui-preview` green (native)
- [ ] `cargo check -p pokered-ui-preview --target wasm32-unknown-unknown` green
- [ ] `wasm-pack build --target web crates/pokered-ui-preview` produces a working `pkg/`
- [ ] `PreviewSession::render()` returns 92160 bytes (= 160 × 144 × 4) for at least one screen
- [ ] No `unsafe` blocks in this crate
- [ ] No self-referential lifetimes in `PreviewSession`

## Effort

1 day (revised up from 0.5 day). The wiring is more delicate now that `FrameBufferPainter` is borrowed-style; the per-render construction pattern needs careful coding to avoid lifetime errors. Step 2.5 still implements the actual rendering logic.
