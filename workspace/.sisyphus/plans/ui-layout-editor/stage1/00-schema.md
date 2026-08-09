# Step 1.0 — JSON Schema Design

## Externalization Boundary

| What | Where it lives |
|------|---------------|
| `TileRect` (box positions/sizes) | JSON |
| Box `InkColor` | JSON |
| Static label texts ("BUY", "SELL", "HP:", "TYPE1/", ...) | JSON |
| Static label positions | JSON |
| Cursor base position, row_step, glyph, color | JSON |
| List params: `item_start_ty`, `row_step`, `max_visible_rows` | JSON |
| Primitive coords: bracket_box rect+sides, hp_bar tile pos+width, vline/hline tile pos+length | JSON |
| Per-screen variant grouping | JSON (one file per menu module, multiple variants inside) |
| | |
| Derived cursor formulas (`base_ty + cursor*row_step`) | Code (consumes JSON params) |
| `format!("{:<12} ${:<5}", ...)` | Code |
| Item list iteration / data lookups | Code |
| Conditional logic (e.g. only show TYPE2 if mon has 2 types) | Code |
| Text wrapping algorithm | Code |
| Scroll offset application | Code |
| hp_bar fill computation (hp/max_hp * width_pixels) | Code |
| Status code → display text mapping | Code |

**Rule of thumb**: if a value is a literal in current source (`TileRect::new(0, 0, 10, 6)`, `"BUY"`), externalize it. If it's a computation (`1 + cursor * 2`), keep the formula in code but externalize the inputs (`base_ty: 1, row_step: 2`).

## File Organization

One file per menu module:

```
crates/pokered-data/ui_layouts/
├── bag.json
├── battle_bag.json
├── battle_main.json
├── battle_move.json
├── battle_party.json
├── battle_text.json
├── dialog.json
├── main.json
├── mart.json
├── naming.json
├── options.json
├── party.json
├── save.json
├── start.json
└── stats.json
```

**15 files total**, matching the actual menu module count in `crates/pokered-ui/src/menus/` (verified: 16 files = 15 menu modules + `mod.rs`). Several modules contain multiple distinct screens which become multiple `variants` inside the same JSON file.

## Top-Level Schema

```typescript
interface UiLayoutFile {
  schema_version: 1;
  screen: string;                          // e.g. "mart"
  variants: Record<string, VariantDef>;    // e.g. { "main_menu": {...}, "buy_items_with_money": {...} }
}

interface VariantDef {
  boxes?: BoxDef[];
  regions?: RegionDef[];                   // non-boxed coordinate anchors
  primitives?: PrimitiveDef[];
  list?: ListParams;                       // optional, for variants with scrollable lists
  cursor?: CursorDef;                      // optional, for variants with a single cursor
  dynamic_labels?: Record<string, DynamicLabelDef>;  // positions for code-supplied text
  enum_position_map?: Record<string, number>;        // for options.rs-style enum→position
}

interface BoxDef {
  id: string;                              // stable key, e.g. "menu_box"
  rect: TileRect;
  color: InkColor;
  labels?: LabelDef[];                     // static labels inside this box

  // Dynamic sizing (post-momus S4):
  // When `dynamic_height` is set, `rect.th` is treated as the MINIMUM height; actual height is
  // computed at draw time as `min_th + extra_per_row * dynamic_row_count`. The `dynamic_row_count`
  // is supplied by the calling code (e.g. mart sell menu: `bag_items.len()`). The box's
  // `cancel_row` / cursor extents derive from the same formula but stay code-side.
  dynamic_height?: {
    extra_per_row: number;                 // additional tiles per dynamic row (e.g. 2 for mart)
    // dynamic_row_count is NOT in JSON — supplied by code per render
  };
}

interface RegionDef { id: string; rect: TileRect; }

interface LabelDef { tx: number; ty: number; text: string; color: InkColor; }

interface DynamicLabelDef {
  parent: string;                          // box or region id, or "screen"
  tx: number;
  ty: number;
  text?: string;                           // if present: static label; else: code supplies
  color: InkColor;
}

interface CursorDef {
  tx: number;
  base_ty: number;
  row_step: number;
  glyph?: string;                          // default "▶"
  color: InkColor;
}

interface ListParams {
  item_start_ty: number;
  row_step: number;
  max_visible_rows: number;
  cursor: CursorDef;
}

interface PrimitiveDef {
  id: string;
  parent_id: string | null;                // box/region id, or null for screen-absolute
  kind: "bracket_box" | "hp_bar" | "vline" | "hline" | "pixel_rect";
  color: InkColor;
  // shape fields by kind:
  rect?: TileRect;                         // bracket_box, pixel_rect (in tiles or pixels — see kind)
  sides?: { top: bool; bottom: bool; left: bool; right: bool };
  with_arrow?: boolean;                    // bracket_box
  tx?: number; ty?: number;                // hp_bar, vline, hline anchor
  width_tiles?: number;                    // hp_bar
  length_tiles?: number;                   // vline, hline
  px?: number; py?: number; pw?: number; ph?: number;  // pixel_rect (raw pixels)
}

interface TileRect { tx: number; ty: number; tw: number; th: number; }

type InkColor = "Black" | "DarkGray" | "LightGray" | "White"
              | "HpFull" | "HpCaution" | "HpCritical";
```

## Worked Example 1 — `mart.json`, variant `main_menu`

```json
{
  "schema_version": 1,
  "screen": "mart",
  "variants": {
    "main_menu": {
      "boxes": [
        {
          "id": "menu_box",
          "rect": { "tx": 0, "ty": 0, "tw": 10, "th": 6 },
          "color": "Black",
          "labels": [
            { "tx": 2, "ty": 1, "text": "BUY",  "color": "Black" },
            { "tx": 2, "ty": 3, "text": "SELL", "color": "Black" },
            { "tx": 2, "ty": 5, "text": "QUIT", "color": "Black" }
          ]
        }
      ],
      "cursor": { "tx": 1, "base_ty": 1, "row_step": 2, "glyph": "▶", "color": "Black" }
    }
  }
}
```

Code reads `cursor.base_ty + state.cursor() as u32 * cursor.row_step` to derive the cursor row.

## Worked Example 2 — `mart.json`, variant `sell_items_with_money`

```json
{
  "variants": {
    "sell_items_with_money": {
      "boxes": [
        { "id": "item_box",  "rect": {"tx":0,"ty":0,"tw":18,"th":14}, "color": "Black" },
        {
          "id": "money_box",
          "rect": {"tx":0,"ty":14,"tw":18,"th":3},
          "color": "Black",
          "labels": [{ "tx": 1, "ty": 1, "text": "MONEY $", "color": "Black" }]
        }
      ],
      "list": {
        "item_start_ty": 1,
        "row_step": 2,
        "max_visible_rows": 12,
        "cursor": { "tx": 1, "base_ty": 1, "row_step": 2, "color": "Black" }
      }
    }
  }
}
```

## Worked Example 3 — `stats.json`, variant `page1` (abridged)

```json
{
  "variants": {
    "page1": {
      "regions": [
        { "id": "screen", "rect": {"tx":0,"ty":0,"tw":20,"th":18} }
      ],
      "boxes": [
        { "id": "stat_box", "rect": {"tx":0,"ty":8,"tw":8,"th":8}, "color": "Black" }
      ],
      "primitives": [
        {
          "id": "top_bracket",
          "kind": "bracket_box",
          "parent_id": "screen",
          "rect": {"tx":9,"ty":1,"tw":11,"th":7},
          "sides": {"top": false, "bottom": true, "left": false, "right": true},
          "with_arrow": true,
          "color": "Black"
        },
        {
          "id": "hp_bar",
          "kind": "hp_bar",
          "parent_id": "screen",
          "tx": 13, "ty": 3, "width_tiles": 6,
          "color": "Black"
        }
      ],
      "dynamic_labels": {
        "name":         { "parent": "screen", "tx": 9,  "ty": 1, "color": "Black" },
        "level":        { "parent": "screen", "tx": 14, "ty": 2, "color": "Black" },
        "hp_label":     { "parent": "screen", "tx": 10, "ty": 3, "text": "HP:", "color": "Black" },
        "hp_value":     { "parent": "screen", "tx": 13, "ty": 4, "color": "Black" },
        "type1_label":  { "parent": "screen", "tx": 11, "ty": 9, "text": "TYPE1/", "color": "Black" },
        "type1_value":  { "parent": "screen", "tx": 12, "ty": 10, "color": "Black" }
      }
    }
  }
}
```

## Worked Example 4 — Dynamic Box Height (`mart.json`, variant `buy_items_with_money`)

The mart "buy items" menu has a box that grows with the number of items the player can buy. The original code computes `bag_items.len() * 2 + 1` for the cancel row and sizes the box accordingly. JSON captures the `extra_per_row` ratio; code supplies the row count per render.

```json
{
  "variants": {
    "buy_items_with_money": {
      "boxes": [
        {
          "id": "item_box",
          "rect": { "tx": 0, "ty": 0, "tw": 18, "th": 4 },
          "color": "Black",
          "dynamic_height": { "extra_per_row": 2 }
        },
        {
          "id": "money_box",
          "rect": { "tx": 0, "ty": 14, "tw": 18, "th": 3 },
          "color": "Black",
          "labels": [{ "tx": 1, "ty": 1, "text": "MONEY $", "color": "Black" }]
        }
      ],
      "list": {
        "item_start_ty": 1,
        "row_step": 2,
        "max_visible_rows": 5,
        "cursor": { "tx": 1, "base_ty": 1, "row_step": 2, "color": "Black" }
      }
    }
  }
}
```

Code pattern for dynamic_height consumers:

```rust
let layout = &MART_LAYOUT.buy_items_with_money;
let item_box = &layout.item_box;
let actual_th = item_box.rect.th + match &item_box.dynamic_height {
    Some(dh) => dh.extra_per_row * (bag_items.len() as u32),
    None => 0,
};
let resolved_rect = TileRect { th: actual_th, ..item_box.rect };
frame.bracket_box(resolved_rect, BracketSides::ALL, item_box.color);
```

The editor preview must also resolve `dynamic_height` — Stage 2 wasm preview accepts a `dynamic_row_counts: { "item_box": 5 }` parameter from the editor UI so the user can preview different list lengths.



| Case | Treatment |
|------|-----------|
| Multiple variants of one screen (`mart.draw_main_menu` vs `mart.draw_main_with_money`) | Separate entries under `variants: {}` |
| `cancel_row = 1 + (bag_items.len() * 2)` | Box uses `dynamic_height: { extra_per_row: 2 }`; JSON provides `row_step: 2` for list cursor; cancel_row formula stays in code. Actual `th` at draw = `rect.th + 2 * bag_items.len()`. |
| `options.rs` cursor positions per enum value | `enum_position_map: { "Fast": 0, "Medium": 6, "Slow": 13 }` |
| `naming.rs` keyboard grid tile IDs | Grid layout (rows×cols, spacing) externalized; tile IDs from state stay code-side |
| `battle_party.rs` scrolling 4-visible window | `max_visible: 4` externalized; scroll computation in code |
| Unanticipated weird pattern | **No `code_override` escape hatch.** If schema can't express it, schema is wrong — extend schema, don't bypass it. (See risks doc §Decision 4.) |
