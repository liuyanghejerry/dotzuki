# Step 1.6 — Migrate Remaining Menus

After main.rs (validation) and mart.rs (stress test), migrate the remaining 13 menu modules (15 total − main − mart). The pattern is now mechanical — each menu takes 30-90 minutes depending on complexity.

## Migration Order (Easiest → Hardest)

Grouped by complexity. Migrate top-down; each group's lessons inform the next.

### Group A: Trivial (single-variant, no scroll, no primitives)

1. `save.rs` — yes/no confirmation
2. `start.rs` — fixed menu list
3. `dialog.rs` — text box only (likely no boxes/cursors at all — just text rendering)
4. `battle_text.rs` — battle dialog box

**Estimated effort**: 30 min each.

### Group B: Multi-variant menus

5. `options.rs` — option rows with enum-position mapping
6. `battle_main.rs` — fight/pkmn/item/run grid
7. `battle_move.rs` — 4 move slots + PP/type display

**Estimated effort**: 45-60 min each.

### Group C: Lists with scroll

8. `bag.rs` — item list with quantities, scroll, CANCEL row (very similar to mart)
9. `battle_bag.rs` — bag during battle
10. `party.rs` — 6 pokemon slots, hp bars
11. `battle_party.rs` — party menu during battle (switch target)

**Estimated effort**: 60-90 min each. Reuse mart.rs patterns directly.

### Group D: Special

12. `naming.rs` — keyboard grid (rows × cols + spacing externalized; dynamic glyph at each cell stays code-side)
13. `stats.rs` — multi-page (page1 stats / page2 moves), brackets, hp bar, label-value grid

**Estimated effort**: 90-120 min each. These exercise primitives and grid layouts more than any other screen.

## Per-Menu Migration Recipe

For every menu file:

1. **Verify seed JSON exists** for this screen at `crates/pokered-data/ui_layouts/<screen>.json`. If missing or incomplete, hand-fill before migrating code.
2. **Add layout parameter** to each `pub fn draw_*` function:
   ```rust
   pub fn draw_X<P: Painter>(state: &XState, layout: &XVariant, ui: &mut Ui<P>) { ... }
   ```
3. **Replace** every `TileRect::new(...)` with `layout.SOMEBOX.rect`.
4. **Replace** every static-text `frame.label(tx, ty, "TEXT", color)` with iteration over `layout.SOMEBOX.labels`.
5. **Replace** every cursor formula `1 + cursor*2` with `layout.cursor.base_ty + cursor * layout.cursor.row_step`.
6. **Replace** every list bound `.take(N)` with `.take(layout.list.max_visible_rows as usize)`.
7. **Replace** every primitive call (`bracket_box`, `hp_bar`, `vline`, etc.) with `layout.SOMEPRIM.kind` dispatch.
8. **Update callers** in `pokered-core` / state machines to pass the right variant.
9. **Update tests** — only signature changes, **assertions unchanged**.
10. **Verify**: `cargo test -p pokered-ui --test menus -- <menu_name>` green.

## Menu-Specific Notes

### `options.rs` — Enum-Position Mapping

Schema field `enum_position_map`:
```json
{
  "text_speed_row": {
    "tx": 1, "ty": 3,
    "options": [
      { "value": "Fast",   "tx_offset": 0  },
      { "value": "Medium", "tx_offset": 5  },
      { "value": "Slow",   "tx_offset": 11 }
    ]
  }
}
```

Code:
```rust
let row = &layout.text_speed_row;
for opt in row.options {
    if state.text_speed == opt.value_enum() {
        frame.cursor_glyph_at(row.tx + opt.tx_offset, row.ty, '▶', color);
    }
}
```

(Need a small `value_enum()` helper or `match opt.value` — keep enum mapping code-side; only positions are JSON.)

### `naming.rs` — Keyboard Grid

```json
{
  "keyboard_grid": {
    "tx_origin": 1, "ty_origin": 4,
    "rows": 5, "cols": 9,
    "cell_step_tx": 2, "cell_step_ty": 2
  }
}
```

Code computes `(tx, ty)` for cell `(row, col)`:
```rust
let g = &layout.keyboard_grid;
for row in 0..g.rows {
    for col in 0..g.cols {
        let tx = g.tx_origin + col * g.cell_step_tx;
        let ty = g.ty_origin + row * g.cell_step_ty;
        let glyph = state.charset[(row * g.cols + col) as usize];
        frame.label(tx, ty, &glyph.to_string(), InkColor::Black);
    }
}
```

Glyph contents stay in code (driven by `charset` state — uppercase / lowercase / symbols).

### `stats.rs` — Multi-Page + Primitives

Two variants in `stats.json`: `page1` and `page2`. Each declares its own boxes + primitives.

`hp_bar` primitive needs:
- Position (`tx`, `ty`)
- Length in tiles (`width_tiles`)
- Fill ratio is computed from state, NOT in JSON

```rust
match layout.hp_bar.kind {
    PrimitiveKind::HpBar { tx, ty, width_tiles } => {
        let fill = (state.hp as f32 / state.max_hp as f32 * width_tiles as f32 * 8.0) as u32;
        frame.hp_bar(tx, ty, width_tiles, fill);
    }
    _ => unreachable!(),
}
```

### `battle_party.rs` — Reuse `party.rs` Layout?

Battle party and overworld party look similar but may have small offsets. Keep them as **separate JSON files** (`party.json` / `battle_party.json`) — never share by reference. Sharing creates coupling that bites later when one screen needs to change.

## Acceptance Checklist (per menu)

- [ ] `grep -n 'TileRect::new\|frame.label.*"' crates/pokered-ui/src/menus/<menu>.rs` returns 0 hits for static literals
- [ ] All draw functions take a `layout: &<Variant>` parameter
- [ ] All callers updated
- [ ] Tests pass with **zero assertion changes**
- [ ] `cargo clippy -p pokered-ui` clean

## Acceptance Checklist (whole stage)

After all menus migrated:

- [ ] `grep -rn 'TileRect::new' crates/pokered-ui/src/menus/` returns **0 results**
- [ ] `grep -rn 'frame.label.*".*"' crates/pokered-ui/src/menus/` returns 0 (all static labels JSON-sourced)
- [ ] `cargo test --workspace` green (all 2,446 tests)
- [ ] `cargo clippy --workspace -- -D warnings` clean
- [ ] Manual smoke test: boot game, visit mart / open bag / view party / start battle / name pokemon — visually identical to baseline

## What If a Menu Reveals a Schema Gap?

If you find a layout pattern the schema can't express:

1. **STOP** that menu's migration immediately
2. Extend the schema (`stage1/00-schema.md` types + `stage1/02-rust-types.md` + `build.rs`)
3. Re-run seed script for **only the affected files** (or hand-edit if seed regex won't catch it)
4. Resume migration

Do **not** add `code_override` escape hatches. Do **not** keep raw `TileRect::new(...)` in code "just for this one tricky case." If we accept exceptions, the editor can't edit those screens and the whole project is undermined.

## Effort Sizing

- Group A: ~2 hours total
- Group B: ~3 hours total
- Group C: ~4 hours total
- Group D: ~3-4 hours total

**Stage 1.6 total: ~1.5 days**
