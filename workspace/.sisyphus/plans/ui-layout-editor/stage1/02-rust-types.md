# Step 1.2 — Schema Rust Types in `pokered-data`

Add the runtime Rust types that the codegen (step 1.3) will instantiate. These types use `Cow<'static, T>` so they work for **both** compile-time generated statics (from `build.rs`) **and** runtime-parsed layouts (from the wasm preview's `set_layout(json)`).

> **Why Cow not `&'static str`**: Step 2.4 (runtime layout parser) requires constructing layouts from heap-allocated strings sent by the editor. `&'static str` would force `Box::leak` (memory leak per edit) or a parallel "owned" type system. `Cow<'static, T>` lets compile-time codegen emit `Cow::Borrowed("BUY")` (zero-cost) and runtime parser emit `Cow::Owned(string)` — same type, same menu code paths.

## Location

`crates/pokered-data/src/ui_layout/mod.rs` — public module exposing the schema types and the generated registry.

```
crates/pokered-data/src/
├── lib.rs
├── ui_layout/
│   ├── mod.rs           # NEW: schema types + re-exports of generated statics
│   └── (build.rs writes ui_layouts_gen.rs into OUT_DIR; mod.rs include!()s it)
```

## Type Definitions

```rust
// crates/pokered-data/src/ui_layout/mod.rs

use std::borrow::Cow;
use serde::Deserialize;

// NOTE: InkColor, TileRect, BracketSides MUST be defined in pokered-data, not pokered-ui.
// pokered-ui already depends on pokered-data, so the reverse direction would be circular.
//
// Action required during step 1.2:
//   1. Move InkColor, TileRect, BracketSides from `crates/pokered-ui/src/engine.rs`
//      into `crates/pokered-data/src/ui_layout/types.rs` with #[derive(Deserialize)] gated
//      by the `serde` feature.
//   2. In `crates/pokered-ui/src/engine.rs`, replace the original definitions with:
//        pub use pokered_data::ui_layout::{InkColor, TileRect, BracketSides};
//   3. All existing pokered-ui call sites continue to work because the path is re-exported.
pub use crate::ui_layout::types::{InkColor, TileRect, BracketSides};

#[derive(Debug, Clone, Deserialize)]
pub struct BoxDef {
    pub id: Cow<'static, str>,
    pub rect: TileRect,
    pub color: InkColor,
    pub labels: Cow<'static, [LabelDef]>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LabelDef {
    pub tx: u32,
    pub ty: u32,
    pub text: Cow<'static, str>,
    pub color: InkColor,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RegionDef {
    pub id: Cow<'static, str>,
    pub rect: TileRect,
}

#[derive(Debug, Clone, Copy, Deserialize)]
pub struct CursorDef {
    pub tx: u32,
    pub base_ty: u32,
    pub row_step: u32,
    #[serde(default = "default_cursor_glyph")]
    pub glyph: char,
    pub color: InkColor,
}

fn default_cursor_glyph() -> char { '\u{25B6}' }   // ▶ — matches engine.rs Frame::cursor_at

#[derive(Debug, Clone, Copy, Deserialize)]
pub struct ListParams {
    pub item_start_ty: u32,
    pub row_step: u32,
    pub max_visible_rows: u32,
    pub cursor: CursorDef,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DynamicLabelDef {
    pub parent: Cow<'static, str>,
    pub tx: u32,
    pub ty: u32,
    pub text: Option<Cow<'static, str>>,
    pub color: InkColor,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PrimitiveDef {
    pub id: Cow<'static, str>,
    pub parent_id: Option<Cow<'static, str>>,
    pub kind: PrimitiveKind,
    pub color: InkColor,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PrimitiveKind {
    BracketBox { rect: TileRect, sides: BracketSides, with_arrow: bool },
    HpBar { tx: u32, ty: u32, width_tiles: u32 },
    VLine { tx: u32, ty: u32, length_tiles: u32 },
    HLine { tx: u32, ty: u32, length_tiles: u32 },
    PixelRect { px: u32, py: u32, pw: u32, ph: u32 },
}

// Per-screen layout structs are GENERATED — see step 1.3.
// Example of what the codegen emits:
//
//   pub struct MartLayout {
//       pub main_menu: MartMainMenu,
//       pub main_with_money: MartMainWithMoney,
//       // ...
//   }
//
//   pub struct MartMainMenu {
//       pub menu_box: BoxDef,
//       pub cursor: CursorDef,
//   }
//
//   pub static MART_LAYOUT: MartLayout = MartLayout {
//       main_menu: MartMainMenu {
//           menu_box: BoxDef {
//               id: Cow::Borrowed("menu_box"),
//               rect: TileRect { tx: 0, ty: 0, tw: 10, th: 6 },
//               color: InkColor::Black,
//               labels: Cow::Borrowed(&[
//                   LabelDef { tx: 2, ty: 1, text: Cow::Borrowed("BUY"),  color: InkColor::Black },
//                   ...
//               ]),
//           },
//           cursor: CursorDef { tx: 1, base_ty: 1, row_step: 2, glyph: '\u{25B6}', color: InkColor::Black },
//       },
//       ...
//   };

// Generated registry:
include!(concat!(env!("OUT_DIR"), "/ui_layouts_gen.rs"));
```

## Why `Clone` Instead of `Copy`

`Cow<'static, str>` and `Cow<'static, [T]>` are not `Copy` because `Cow::Owned` holds heap allocations. So all schema structs are `Clone` only.

This is fine in practice. Menu code reads through `&` references:

```rust
let cursor = &layout.cursor;     // borrow, not move
let row = cursor.base_ty + state.cursor() as u32 * cursor.row_step;

for label in layout.menu_box.labels.iter() {     // iterate borrow
    frame.label(label.tx, label.ty, &label.text, label.color);
}
```

Note `&label.text` — `Cow<str>` derefs to `&str`, so `frame.label(.., text: &str, ..)` works unchanged.

## `BracketSides` Source of Truth

`BracketSides` already exists at `crates/pokered-ui/src/engine.rs` (verified). Re-export from there — do not redefine. Add `Deserialize` derive in `pokered-ui` if not already present:

```rust
// crates/pokered-ui/src/engine.rs (if needed)
#[cfg_attr(feature = "serde", derive(serde::Deserialize))]
#[derive(Debug, Clone, Copy)]
pub struct BracketSides { ... }
```

Add a `serde` feature to `pokered-ui`'s `Cargo.toml`. `pokered-data` enables it via `pokered-ui = { features = ["serde"] }`.

Same treatment for `TileRect` and `InkColor` — they're in `pokered-ui::engine` and need `Deserialize` for runtime parsing.

## Verification Gate

```bash
cargo check -p pokered-data --no-default-features    # types compile, no codegen yet
```

(Note: codegen output will be empty until step 1.3, so write a tiny stub `OUT_DIR/ui_layouts_gen.rs` with `pub fn get_layout_json(_screen: &str) -> Option<&'static str> { None }` for this step to compile standalone.)

Or simpler: skip standalone build until step 1.3 lands — types and codegen go together.

## Anti-Patterns to Avoid

- ❌ `&'static str` fields → forces `Box::leak` for runtime parsing (covered above)
- ❌ Plain `String` / `Vec<T>` → loses zero-cost path for compile-time generated statics
- ❌ `HashMap<String, BoxDef>` for variant lookup → use named fields on per-screen struct (compile-time checked)
- ❌ Trait objects (`Box<dyn ...>`) → no need; everything is statically dispatched
- ❌ `Option<u32>` fields with sentinel meanings → use distinct types or `enum`
- ❌ `#[derive(Copy)]` on any schema struct → Cow is not Copy

## Cross-References

- Step 1.3 codegen must emit `Cow::Borrowed(...)` for all string/slice fields
- Step 2.4 runtime parser uses `serde_json::from_str::<MartLayout>(json)?` — derives above make this one-liner work
- Step 1.4–1.6 menu migrations use `&layout.field` (borrow) not `layout.field` (would-be-move)
