# Step 2.5 — wasm-bindgen JS API

The JS-facing surface of `pokered-ui-preview`. Designed for the Vue editor to call from Pinia stores.

## Design Goals

- **Stateful session**: editor opens one `PreviewSession`, mutates it, reads frames
- **Synchronous render**: no async — render is fast (CPU drawing into a 160×144 buffer)
- **Cheap edits**: `set_layout` parses once and caches; `render` just paints from cache
- **Error transparency**: parse/render errors come back as readable JS error messages

## API

```rust
// crates/pokered-ui-preview/src/lib.rs

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct PreviewSession { /* internal state */ }

#[wasm_bindgen]
impl PreviewSession {
    /// Construct a new session. No rendering possible until set_screen() is called.
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self;

    /// List all renderable screen names.
    /// Returns: ["main", "mart", "bag", "party", "stats", ...]
    pub fn list_screens(&self) -> Vec<JsValue>;

    /// Choose which screen to render. Loads default layout JSON for the screen.
    /// Subsequent set_layout / set_state apply to this screen.
    /// Returns: error if screen unknown.
    pub fn set_screen(&mut self, screen: &str) -> Result<(), JsValue>;

    /// Get the current layout JSON (default or last-set).
    /// Used by the editor to seed its JSON editor textarea.
    pub fn get_layout_json(&self) -> String;

    /// Override the layout for the current screen.
    /// Parses immediately; rejects on parse error.
    pub fn set_layout(&mut self, json: &str) -> Result<(), JsValue>;

    /// List available mock states for the current screen.
    /// Returns: ["default", "long_list", "empty", ...]
    pub fn list_mock_states(&self) -> Vec<JsValue>;

    /// Set the mock state by name (must be in list_mock_states output).
    pub fn set_mock_state(&mut self, name: &str) -> Result<(), JsValue>;

    /// Override mock state with arbitrary JSON (for ad-hoc tweaks).
    pub fn set_state(&mut self, json: &str) -> Result<(), JsValue>;

    /// Render current (screen, layout, state) to RGBA pixel buffer.
    /// Buffer is 160 * 144 * 4 = 92,160 bytes, in row-major order.
    pub fn render(&self) -> Result<Box<[u8]>, JsValue>;

    /// Game Boy resolution constants.
    pub fn width(&self) -> u32 { 160 }
    pub fn height(&self) -> u32 { 144 }

    /// Schema introspection — used by the editor to know what fields can be edited.
    /// Returns JSON-as-string of the schema for current screen.
    /// Example: { "boxes": [{"id":"menu_box","fields":["rect","color","labels"]}], ... }
    pub fn get_schema(&self) -> String;
}
```

## Why `Box<[u8]>` Not `Vec<u8>` For Render

`wasm-bindgen` copies `Vec<u8>` into a JS `Uint8Array`. `Box<[u8]>` does the same. `Box<[u8]>` is slightly cheaper because it has no `capacity` field. For 92KB per frame at editor edit rate (maybe 10 fps when dragging), this matters slightly. Use whichever the existing wasm crate (`pokered-web`) uses for consistency.

Optional micro-optimization: expose a JS-accessible `Uint8ClampedArray` view directly into wasm linear memory, avoiding the copy entirely. Defer until profiling shows it's needed.

## JS Usage Example

```typescript
// tools/game-editor/src/composables/usePreview.ts
import init, { PreviewSession } from 'pokered-ui-preview';

let session: PreviewSession;

export async function initPreview() {
    await init();   // wasm bootstrap
    session = new PreviewSession();
}

export function setScreen(name: string) {
    session.set_screen(name);
}

export function setLayout(json: string) {
    try {
        session.set_layout(json);
    } catch (e) {
        console.error('layout parse error:', e);
        throw e;
    }
}

export function render(): ImageData {
    const rgba = session.render();
    return new ImageData(new Uint8ClampedArray(rgba), session.width(), session.height());
}

// In a Vue component:
function blitToCanvas(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;   // pixel-perfect
    const img = render();
    ctx.putImageData(img, 0, 0);
}
```

## Schema Introspection (`get_schema`)

The editor needs to know which fields are editable. Two approaches:

### Approach 1: Schema embedded as JSON

`build.rs` emits a static JSON description per screen alongside the layout itself:

```json
{
  "screen": "mart",
  "variants": {
    "main_menu": {
      "boxes": [
        { "id": "menu_box", "editable_fields": ["rect", "color", "labels"] }
      ],
      "cursor": { "editable_fields": ["tx", "base_ty", "row_step", "glyph"] }
    }
  }
}
```

`get_schema()` returns this string. The editor walks it to build form controls.

### Approach 2: Hardcoded schema in the editor

The editor knows the schema (it's the same JSON it edits). No introspection needed.

**Decision**: Approach 1. The editor is data-driven from the schema; no need to update editor code when a new screen is added. `build.rs` writes the schema descriptor for free as a side-effect of generating layouts.

## Error Handling

Every fallible call returns `Result<T, JsValue>`. `JsValue` is constructed from a string for editor display:

```rust
JsValue::from_str(&format!("layout for screen 'mart' is missing variant 'main_menu'"))
```

The editor catches and displays:

```typescript
try {
    session.set_layout(json);
    setError(null);
} catch (e) {
    setError(`Layout error: ${e}`);
}
```

## Performance Targets

- `set_layout(json)`: < 5ms for typical layout (~5KB JSON)
- `render()`: < 16ms (60fps target during drag interactions)
- Wasm binary size: < 1MB compressed (gzip)

Profile after Stage 2.7 with browser dev tools. If `render()` is slow, the bottleneck is most likely glyph drawing in `embedded_font` — but it's already what the game uses, so it should be fast.

## Acceptance

- [ ] All API methods documented in source with `///` doc comments (visible in TypeScript bindings)
- [ ] `wasm-pack build --target web` produces `pkg/pokered_ui_preview.d.ts` with all methods correctly typed
- [ ] Headless test in `tests/headless.rs`: construct session, set screen, render, assert non-zero pixel count
- [ ] JS smoke test in editor: import package, render mart, blit to canvas, see expected image
- [ ] All errors propagate as readable strings (no `JsValue::null()` or unwrap panics)

## Effort

0.5 day. Most of the API surface is thin wrapping over the parser + render dispatch built in 2.4 + 2.1.
