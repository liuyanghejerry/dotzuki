# Step 1.5 — Migrate `mart.rs` (Stress Test)

`mart.rs` is the most complex menu (~195 lines, 9 variants, scroll, dynamic cursors, multi-box layouts, money panel). If the schema can handle mart, it can handle anything else. **Do not** proceed to step 1.6 until mart is fully migrated and all mart tests are green.

## Why mart.rs Is the Stress Test

- 9 distinct draw functions = 9 layout variants
- 2-box layouts (item list + money panel)
- Scrolling lists with `skip(scroll_offset)`
- Derived cursor positions accounting for scroll
- "CANCEL" entry rendered at variable position (`1 + bag_items.len() * 2`)
- Static labels mixed with dynamic-text labels (item names, quantities)

## Migration Process

### 1. Read the current source thoroughly

```bash
cat crates/pokered-ui/src/menus/mart.rs
```

Identify each `pub fn draw_*` function. List all variants and what makes each unique.

### 2. Confirm seeded JSON

The seed script (step 1.1) should have produced `crates/pokered-data/ui_layouts/mart.json` with all 9 variants. **Verify before migrating code**:

```bash
cat crates/pokered-data/ui_layouts/mart.json | jq '.variants | keys'
# Expected output: array of all 9 variant names
```

If any variant is missing or has `_TODO`, hand-fill it now by reading the source.

### 3. Migrate each draw function, one at a time

For each `pub fn draw_X<P: Painter>(...)`:

1. Add `layout: &MartX` parameter (where `MartX` is the codegen-emitted struct for variant `X`)
2. Replace every `TileRect::new(...)` with `layout.SOME_BOX.rect`
3. Replace every `frame.label(tx, ty, "TEXT", color)` (static text) with iteration over `layout.SOME_BOX.labels`
4. Replace cursor formulas: `1 + cursor*2` → `layout.cursor.base_ty + cursor * layout.cursor.row_step`
5. Replace list params: `for (i, item) in items.iter().take(12).enumerate()` → use `layout.list.max_visible_rows` for the `take` bound
6. Run `cargo test -p pokered-ui --test menus -- mart::draw_X` after each function — verify green before moving to next

### 4. Update callers

The `pokered-core` (or wherever shop logic lives) must pass the right layout variant:

```rust
use pokered_data::ui_layout::MART_LAYOUT;

// In shop state machine
match shop_state.screen {
    ShopScreen::Main => mart::draw_main_menu(&state, &MART_LAYOUT.main_menu, ui),
    ShopScreen::MainWithMoney => mart::draw_main_with_money(&state, &MART_LAYOUT.main_with_money, ui),
    ShopScreen::BuyItems => mart::draw_buy_items_with_money(&items, cursor, scroll, money,
                                                              &MART_LAYOUT.buy_items_with_money, ui),
    // ... etc
}
```

### 5. Verify tests

```bash
cargo test -p pokered-ui --test menus -- mart    # all 9 variants pass
cargo test --workspace                            # nothing else broken
```

## Tricky Cases & How to Handle

### Case A: Variable-position "CANCEL" entry

Current code:
```rust
let cancel_row = 1 + (owned_items.len() as u32 * 2);
frame.label(2, cancel_row, "CANCEL", InkColor::Black);
```

Migration:
```rust
let cancel_row = layout.list.item_start_ty
    + (owned_items.len() as u32 * layout.list.row_step);
frame.label(2, cancel_row, "CANCEL", InkColor::Black);
```

The text "CANCEL" stays in code (it's not a positional label — it's logic-driven). The `2` could come from `layout.list.cancel_label_tx` if we want it editable, but YAGNI for now — keep `2` as code if the seed script doesn't pick it up.

### Case B: Scroll offset

Current:
```rust
for (i, (item_id, qty)) in items.iter().skip(scroll_offset).enumerate().take(12) {
    let row = 1 + (i as u32 * 2);
    // ...
}
```

Migration:
```rust
for (i, (item_id, qty)) in items.iter()
    .skip(scroll_offset)
    .take(layout.list.max_visible_rows as usize)
    .enumerate()
{
    let row = layout.list.item_start_ty + (i as u32 * layout.list.row_step);
    // ...
}
```

### Case C: Money box label

Current:
```rust
ui.text_box(TileRect::new(0, 14, 18, 3), InkColor::Black, |frame| {
    frame.label(1, 1, &format!("MONEY ${}", player_money), InkColor::Black);
});
```

The label text is dynamic (contains `$5000` etc.) so it stays in code. But the **prefix** "MONEY $" is static and should come from JSON:

```json
{
  "money_box": {
    "rect": {"tx":0,"ty":14,"tw":18,"th":3},
    "color": "Black",
    "labels": [{ "tx": 1, "ty": 1, "text": "MONEY $", "color": "Black" }]
  }
}
```

Migration code:
```rust
let mb = &layout.money_box;
ui.text_box(mb.rect, mb.color, |frame| {
    let prefix = mb.labels[0].text;
    let text = format!("{}{}", prefix, player_money);
    frame.label(mb.labels[0].tx, mb.labels[0].ty, &text, mb.labels[0].color);
});
```

This makes the prefix editable (designer could change to "$" or "G:" or whatever).

### Case D: Quantity confirmation dialog (overlay variant)

If mart has variants where one screen overlays another (e.g. quantity selection on top of buy screen), each variant is its own entry in `mart.json`. The caller decides which one to draw.

## Acceptance Checklist for mart.rs

- [ ] All 9 variants migrated
- [ ] `grep -n 'TileRect::new' crates/pokered-ui/src/menus/mart.rs` returns 0 matches
- [ ] All static label string literals replaced by JSON-sourced labels
- [ ] All callers updated
- [ ] `cargo test -p pokered-ui --test menus -- mart` — all mart tests green
- [ ] `cargo test --workspace` green
- [ ] Manual sanity check: `cargo run --release` — actually visit a mart in the game, verify it looks right (this catches non-test-covered visual regressions)

## What This Step Validates

- ✅ Schema can express the most complex menu
- ✅ The migration pattern scales (no new tricks needed for the remaining 9)
- ✅ Test approach holds for multi-variant screens

If schema gaps are found here, **fix the schema** (add fields, refine `ListParams`, etc.) and re-run the seed script. Do not work around with code-side hacks.

## Effort Sizing

mart.rs migration is the bulk of stage 1 effort — allocate 1 day. Each subsequent menu is 30-60 minutes once the pattern is solid.
