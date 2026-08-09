# Step 1.4 — Migrate `main.rs` (Prototype Migration)

`main.rs` is the simplest menu (~20 lines, 1 box, no primitives, no scroll). Migrate it first to validate the end-to-end pipeline before tackling complex screens.

## Current Shape (illustrative — verify against actual file)

```rust
// crates/pokered-ui/src/menus/main.rs
use crate::engine::{InkColor, Painter, TileRect, Ui};

pub struct MainMenuState { cursor: u32 }

pub fn draw_main_menu<P: Painter>(state: &MainMenuState, ui: &mut Ui<P>) {
    ui.text_box(TileRect::new(10, 0, 9, 7), InkColor::Black, |frame| {
        frame.label(2, 1, "CONTINUE", InkColor::Black);
        frame.label(2, 3, "NEW GAME", InkColor::Black);
        frame.label(2, 5, "OPTION", InkColor::Black);
        let cursor_row = 1 + (state.cursor * 2);
        frame.cursor_at(1, cursor_row, InkColor::Black);
    });
}
```

## Migration Step

1. Modify the function signature to accept `layout: &MainMenuMain`:

```rust
use pokered_data::ui_layout::MainMenuMain;

pub fn draw_main_menu<P: Painter>(
    state: &MainMenuState,
    layout: &MainMenuMain,
    ui: &mut Ui<P>,
) {
    let m = &layout.menu_box;
    ui.text_box(m.rect, m.color, |frame| {
        for label in m.labels {
            frame.label(label.tx, label.ty, label.text, label.color);
        }
        let c = &layout.cursor;
        let cursor_row = c.base_ty + state.cursor * c.row_step;
        frame.cursor_glyph_at(c.tx, cursor_row, c.glyph, c.color);
    });
}
```

2. Update every caller to pass the layout:

```rust
// In game loop / wherever main menu is invoked
use pokered_data::ui_layout::MAIN_LAYOUT;
draw_main_menu(&state, &MAIN_LAYOUT.main, &mut ui);
```

3. Update tests:

```rust
// crates/pokered-ui/tests/menus.rs
use pokered_data::ui_layout::MAIN_LAYOUT;

#[test]
fn main_menu_layout() {
    let state = MainMenuState { cursor: 0 };
    let mut ui = Ui::new(Recorder::default());
    draw_main_menu(&state, &MAIN_LAYOUT.main, &mut ui);
    let ops = ui.into_painter().ops;
    // EXISTING ASSERTIONS — must still pass byte-for-byte
    assert_eq!(ops[0], Op::Box { rect: TileRect::new(10, 0, 9, 7), color: InkColor::Black });
    assert_eq!(ops[1], Op::Label { tx: 2, ty: 1, text: "CONTINUE".into(), color: InkColor::Black });
    // ...
}
```

The **only test change** is adding `&MAIN_LAYOUT.main` as a parameter. Assertions are unchanged.

## Required `Frame` API Addition

`frame.cursor_at(tx, ty, color)` exists. We need `frame.cursor_glyph_at(tx, ty, glyph, color)` to support the glyph from `CursorDef`. Two options:

| Option | Pros | Cons |
|--------|------|------|
| Add new `cursor_glyph_at` method | Clean, explicit | New API surface to maintain |
| Keep `cursor_at`, hardcode "▶" inside, ignore JSON `glyph` field initially | Minimal code change | Limits what editor can express |

**Decision**: Add `cursor_glyph_at`. The whole point of externalization is to let the editor change things — including the cursor glyph if a designer wants `"►"` or `">"`. If the new method just delegates to `frame.label(tx, ty, &glyph.to_string(), color)`, the implementation is 3 lines. **Verify against existing impl** — `cursor_at` may already do exactly this, in which case just rename / add an alias.

## Verification Gate

```bash
cargo test -p pokered-ui --test menus -- main           # specific test passes
cargo test -p pokered-ui                                # all menu tests still pass
cargo test --workspace                                   # whole project still passes
```

If this works cleanly, the pipeline is validated. Move on to mart.rs (step 1.5). If anything is awkward, **stop and reassess** — don't propagate awkwardness across 15 menus.

## Acceptance Checklist

- [ ] `main.rs` no longer contains any `TileRect::new(...)` literal
- [ ] `main.rs` no longer contains any string literal label text in `frame.label(...)` calls
- [ ] All callers updated
- [ ] `main_menu_layout` test passes with **zero assertion changes** (only signature change)
- [ ] `cargo test --workspace` green
- [ ] `cargo clippy -p pokered-ui` clean

## What This Step Validates

- ✅ Codegen produces usable types
- ✅ Menu code can read from layout structs cleanly
- ✅ Test infrastructure works with injected layouts
- ✅ Caller-side layout threading is ergonomic enough

If any of these reveal a problem, redesign before scaling to 10 more menus.
