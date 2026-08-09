# Step 2.4 — Runtime Layout Parser

The wasm preview must parse layout JSON strings (sent live from the editor) into the same typed structs the game uses at compile time. This module provides `parse_X_layout(json: &str) -> Result<XLayout, PreviewError>` for each screen.

## Why a Runtime Parser

`pokered-data/build.rs` generates **compile-time** Rust statics from JSON. The game uses those statics directly — no runtime parsing.

The wasm preview can't use the compile-time statics for editor-modified layouts because:
- The editor sends arbitrary new JSON via `set_layout(json)`
- That JSON wasn't seen at build time
- We need to construct a typed layout struct from runtime data

So `pokered-ui-preview` needs its own parser. The output type **must** be the same as the codegen output (so the same `menus::draw_X(state, layout, ui)` works).

## Challenge: `&'static str` Fields

The codegen-emitted layout struct uses `&'static str` for label text:

```rust
pub struct LabelDef {
    pub tx: u32, pub ty: u32,
    pub text: &'static str,
    pub color: InkColor,
}
```

Runtime-parsed JSON gives us `String`, not `&'static str`. Two solutions:

### Option A: Leak strings to make them `&'static`

```rust
let owned: String = json_value["text"].as_str().unwrap().to_string();
let leaked: &'static str = Box::leak(owned.into_boxed_str());
```

**Memory leak** — fine for short-lived previews, but the editor lives in the browser tab indefinitely and edits constantly. Each edit leaks ~50 bytes of string data. Over a long session: 100KB+ of leaked memory. **Acceptable** for a developer tool but ugly.

### Option B: Parallel "owned" type for runtime use

```rust
pub struct LabelDefOwned {
    pub tx: u32, pub ty: u32,
    pub text: String,
    pub color: InkColor,
}
```

But then `menus::draw_X` can't accept both — we'd have to either duplicate every menu function or introduce a trait/Cow-based abstraction.

### Option C: Cow<'static, str>

```rust
pub struct LabelDef {
    pub tx: u32, pub ty: u32,
    pub text: std::borrow::Cow<'static, str>,
    pub color: InkColor,
}
```

- Compile-time codegen emits `Cow::Borrowed("BUY")` (zero-cost)
- Runtime parser emits `Cow::Owned(string)` (one allocation per label)
- `menus::draw_X` works with both transparently because `&str` derefs from `Cow`

**This is the right answer.** Update step 1.2 (Rust types) and 1.3 (codegen) accordingly:

```rust
// pokered-data/src/ui_layout/mod.rs
use std::borrow::Cow;

#[derive(Debug, Clone)]
pub struct LabelDef {
    pub tx: u32, pub ty: u32,
    pub text: Cow<'static, str>,
    pub color: InkColor,
}
```

(Loses `Copy` because `Cow::Owned` isn't Copy. Switch to `Clone`. Menu code that did `let label = layout.box.labels[0]` becomes `let label = &layout.box.labels[0]`.)

Same treatment for `id: &'static str` → `id: Cow<'static, str>` and `BoxDef.labels: &'static [LabelDef]` → `BoxDef.labels: Cow<'static, [LabelDef]>`.

**This is a non-trivial design change.** Confirm it during step 1.2 implementation; don't discover it here in Stage 2.

## Parser Implementation

```rust
// crates/pokered-ui-preview/src/parser.rs

use pokered_data::ui_layout::*;
use serde_json::Value;
use std::borrow::Cow;
use crate::error::PreviewError;

pub fn parse_mart_layout(json: &str) -> Result<MartLayout, PreviewError> {
    let value: Value = serde_json::from_str(json)?;
    expect_schema_version(&value, 1)?;

    let variants = value["variants"].as_object()
        .ok_or_else(|| PreviewError::LayoutMismatch {
            screen: "mart".into(),
            detail: "missing variants object".into(),
        })?;

    Ok(MartLayout {
        main_menu: parse_mart_main_menu(&variants["main_menu"])?,
        main_with_money: parse_mart_main_with_money(&variants["main_with_money"])?,
        // ... all variants
    })
}

fn parse_mart_main_menu(v: &Value) -> Result<MartMainMenu, PreviewError> {
    Ok(MartMainMenu {
        menu_box: parse_box(&v["boxes"][0])?,
        cursor: parse_cursor(&v["cursor"])?,
    })
}

fn parse_box(v: &Value) -> Result<BoxDef, PreviewError> {
    Ok(BoxDef {
        id: Cow::Owned(v["id"].as_str().unwrap_or_default().to_string()),
        rect: parse_tile_rect(&v["rect"])?,
        color: parse_ink_color(&v["color"])?,
        labels: Cow::Owned(parse_labels(&v["labels"])?),
    })
}

fn parse_labels(v: &Value) -> Result<Vec<LabelDef>, PreviewError> {
    let arr = v.as_array().unwrap_or(&Vec::new()).clone();
    arr.iter().map(parse_label).collect()
}

fn parse_label(v: &Value) -> Result<LabelDef, PreviewError> {
    Ok(LabelDef {
        tx: v["tx"].as_u64().unwrap() as u32,
        ty: v["ty"].as_u64().unwrap() as u32,
        text: Cow::Owned(v["text"].as_str().unwrap().to_string()),
        color: parse_ink_color(&v["color"])?,
    })
}

fn parse_tile_rect(v: &Value) -> Result<TileRect, PreviewError> {
    Ok(TileRect {
        tx: v["tx"].as_u64().unwrap() as u32,
        ty: v["ty"].as_u64().unwrap() as u32,
        tw: v["tw"].as_u64().unwrap() as u32,
        th: v["th"].as_u64().unwrap() as u32,
    })
}

fn parse_ink_color(v: &Value) -> Result<InkColor, PreviewError> {
    match v.as_str().unwrap_or("Black") {
        "Black" => Ok(InkColor::Black),
        "White" => Ok(InkColor::White),
        other => Err(PreviewError::LayoutMismatch {
            screen: "(any)".into(),
            detail: format!("unknown InkColor: {}", other),
        }),
    }
}

fn parse_cursor(v: &Value) -> Result<CursorDef, PreviewError> {
    Ok(CursorDef {
        tx: v["tx"].as_u64().unwrap() as u32,
        base_ty: v["base_ty"].as_u64().unwrap() as u32,
        row_step: v["row_step"].as_u64().unwrap() as u32,
        glyph: v["glyph"].as_str().unwrap_or("▶").chars().next().unwrap_or('▶'),
        color: parse_ink_color(&v["color"])?,
    })
}

fn expect_schema_version(v: &Value, expected: u64) -> Result<(), PreviewError> {
    match v["schema_version"].as_u64() {
        Some(n) if n == expected => Ok(()),
        Some(other) => Err(PreviewError::LayoutMismatch {
            screen: "(any)".into(),
            detail: format!("schema_version {} not supported (expected {})", other, expected),
        }),
        None => Err(PreviewError::LayoutMismatch {
            screen: "(any)".into(),
            detail: "missing schema_version".into(),
        }),
    }
}

// Repeat parse_X_layout for each screen.
```

## Reduce Boilerplate with serde

The above hand-written parser is verbose. Alternative: derive `Deserialize` on the layout structs themselves:

```rust
// in pokered-data/src/ui_layout/mod.rs
#[derive(Debug, Clone, Deserialize)]
pub struct LabelDef { /* ... */ }
```

Then parser becomes:
```rust
let layout: MartLayout = serde_json::from_str(json)?;
```

**Trade-off**: requires `serde` as a dependency of `pokered-data` (currently doesn't have it). And the JSON shape must exactly match the struct field names — which means redesigning the JSON schema slightly to be deserializable.

**Decision**: Use serde derive. It's worth the dependency cost to avoid 500+ lines of hand-written parser. Update step 1.2 (Rust types) to add `#[derive(Deserialize)]` everywhere. Update step 1.0 (schema) to ensure JSON field names match Rust field names.

## Caching

Parsing on every render is wasteful. Cache the parsed layout:

```rust
#[wasm_bindgen]
pub struct PreviewSession {
    current_screen: String,
    cached_layout: Option<CachedLayout>,
    // ...
}

enum CachedLayout {
    Mart(MartLayout),
    Bag(BagLayout),
    Party(PartyLayout),
    // ...
}

impl PreviewSession {
    pub fn set_layout(&mut self, json: &str) -> Result<(), JsValue> {
        self.cached_layout = Some(match self.current_screen.as_str() {
            "mart" => CachedLayout::Mart(parser::parse_mart_layout(json)?),
            "bag"  => CachedLayout::Bag(parser::parse_bag_layout(json)?),
            // ...
            _ => return Err(...),
        });
        Ok(())
    }
}
```

Each `set_layout` call parses once; subsequent `render()` calls just dispatch on the cached enum.

## Acceptance

- [ ] Decision made on string ownership: `Cow<'static, str>` adopted in step 1.2
- [ ] Decision made on parser: serde derive vs hand-written (recommend serde)
- [ ] `parse_X_layout(json) -> Result<XLayout, PreviewError>` exists for each screen
- [ ] Round-trip test: load default JSON via codegen, serialize back to JSON, re-parse with runtime parser, compare structs → equal
- [ ] Editor can call `set_layout(modified_json)` and re-render reflects the modification

## Effort

0.5 day if serde derive works cleanly; 1.5 days if hand-written parsers needed.

## Key Decision Forced By This Step

**Step 1.2 must use `Cow<'static, str>`, not `&'static str`.** This wasn't obvious in step 1.2 alone — only Stage 2's runtime parsing exposes the constraint. Update step 1.2 plan now (or accept the leak-strings hack).
