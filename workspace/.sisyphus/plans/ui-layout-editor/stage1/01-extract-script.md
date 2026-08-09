# Step 1.1 — Extract Script (Seed Initial JSON)

Write a Python (or Rust) script that parses every `crates/pokered-ui/src/menus/*.rs` file and emits the initial JSON files under `crates/pokered-data/ui_layouts/`, **byte-for-byte matching** the current hardcoded values.

## Why an Automated Script (not hand-written)

- 15 menu modules × multiple variants × dozens of literals = hundreds of values
- One typo in seeding = test failure with cryptic coordinate diff
- Repeatable: if we tweak schema mid-stage, re-run to re-seed

> **Realistic expectations (post-momus S3)**: This script will NOT produce drop-in-correct JSON for all 15 modules on first run. Expect:
> - **~50-60% of variants** (the simple ones: `mart::draw_main_menu`, `start::draw_start_menu`, `save::draw_save_menu`) extracted cleanly
> - **~30-40%** extracted with `_TODO` markers requiring manual fill-in (cursor formula variants, conditional layouts, dynamic_height boxes)
> - **~10-20%** require full hand-authoring because the source pattern is too dynamic to regex (e.g., `naming.rs` keyboard grid construction, `stats.rs` multi-page bracket math, `battle_main.rs` HP bar positioning derived from sprite coords)
>
> **Total seeding effort**: 2-4 days of operator time = 1 day script writing + 1-2 days manual fill-in + 0.5-1 day cross-checking against compiled output. Allocate accordingly. Do not assume "run script, done."

## What to Extract

For each menu module, extract every:

| Source pattern | Goes into JSON as |
|----------------|-------------------|
| `TileRect::new(x, y, w, h)` | `BoxDef.rect` (with surrounding `text_box` for color) |
| `frame.label(tx, ty, "TEXT", InkColor::X)` | `BoxDef.labels[]` |
| `frame.cursor_at(tx, ty, color)` | `CursorDef` (must reverse-engineer base_ty + row_step from the formula) |
| `frame.bracket_box(rect, sides, with_arrow, color)` | `PrimitiveDef { kind: "bracket_box" }` |
| `frame.hp_bar(tx, ty, width, color)` | `PrimitiveDef { kind: "hp_bar" }` |
| `frame.vline(tx, ty, len, color)` | `PrimitiveDef { kind: "vline" }` |
| `frame.hline(tx, ty, len, color)` | `PrimitiveDef { kind: "hline" }` |
| `frame.draw_pixel_rect(px, py, pw, ph, color)` | `PrimitiveDef { kind: "pixel_rect" }` |

## Implementation Approach

**Recommended**: Python script using regex (simpler than full Rust AST parser, sufficient for this codebase's straightforward patterns).

Location: `tools/seed_ui_layouts.py` (new directory `tools/` alongside `tools/game-editor/`)

Skeleton:

```python
import re, json, sys
from pathlib import Path

MENUS_DIR = Path("crates/pokered-ui/src/menus")
OUT_DIR = Path("crates/pokered-data/ui_layouts")

TILE_RECT = re.compile(r"TileRect::new\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)")
LABEL = re.compile(r'frame\.label\(\s*(\d+)\s*,\s*(\d+)\s*,\s*"([^"]*)"\s*,\s*InkColor::(\w+)\s*\)')
TEXT_BOX_OPEN = re.compile(r"ui\.text_box\(\s*TileRect::new\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)\s*,\s*InkColor::(\w+)\s*,")
# ... etc.

def parse_menu_file(path):
    """Return dict of { variant_name: VariantDef }."""
    src = path.read_text()
    # find each `pub fn draw_*` block, scope-match braces, extract patterns
    # return per-variant structured data
    ...

def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for menu_file in MENUS_DIR.glob("*.rs"):
        if menu_file.name == "mod.rs":
            continue
        screen = menu_file.stem
        variants = parse_menu_file(menu_file)
        out = { "schema_version": 1, "screen": screen, "variants": variants }
        (OUT_DIR / f"{screen}.json").write_text(
            json.dumps(out, indent=2, ensure_ascii=False) + "\n"
        )

if __name__ == "__main__":
    main()
```

## Tricky Bits the Script Must Handle

1. **Cursor formulas**: source has `let cursor_row = 1 + (state.cursor() as u32 * 2);` then `frame.cursor_at(1, cursor_row, ...)`. Script must:
   - Detect the `let cursor_row = BASE + (... * STEP)` pattern
   - Extract `BASE` and `STEP` into `cursor.base_ty` and `cursor.row_step`
   - Verify `cursor_at` uses `cursor_row` (not a different variable)
   - **If detection fails for a variant, skip that variant and emit a warning.** Operator manually fills in.

2. **List loop bounds**: `for (i, ...) in ....iter().take(N).enumerate()` → `max_visible_rows: N`. Detect via regex on `.take(\d+)` or `.skip(\w+).take(\d+)`.

3. **Variants in same file**: each `pub fn draw_*` is a separate variant. Use the function name minus `draw_` prefix as variant key (e.g. `draw_main_menu` → `main_menu`).

4. **Conditional/branching layouts**: a function may have `if state.has_money() { /* draw money box */ }`. The current strategy: **the seed script extracts the "all branches taken" union** and emits a warning. Operator decides if it should be split into 2 variants or modeled as conditional fields.

5. **Dynamic box heights** (post-momus S4): when source contains a pattern like `let th = base_th + bag_items.len() as u32 * 2;` followed by a `TileRect::new(.., .., .., th)`, the script should:
   - Emit `dynamic_height: { extra_per_row: 2 }` on that box
   - Set `rect.th` to the literal `base_th`
   - **If detection fails, emit `_TODO: "dynamic height"`** — operator fills in by reading the formula. This pattern is rare but high-impact when missed (causes box to render at wrong size).

## Validation Step (built into the script)

After writing JSON, the script must reload each file and verify:
- `schema_version == 1`
- All required fields present per the schema
- Coordinates are non-negative integers
- All `parent_id` references resolve

If any check fails → script exits non-zero and prints which file/field.

## Acceptance Gate

```bash
python3 tools/seed_ui_layouts.py
ls crates/pokered-data/ui_layouts/*.json | wc -l   # == 15
# Search for unresolved _TODO markers — these MUST be filled in before step 1.2
grep -l '_TODO' crates/pokered-data/ui_layouts/*.json   # ideally empty after manual pass
# Manually spot-check 2-3 files for plausibility
# Then proceed to step 1.2
```

## Lifecycle After Seeding

The seed script is a **one-shot bootstrap tool**. After step 1.1, JSON files become the source of truth. The script is committed to the repo for reproducibility, but is not part of the build.

## Failure Mode Plan

If the script can't cleanly extract a particular variant (too dynamic, weird pattern):
- Emit a stub `{ "variants": { "VARIANT": { "_TODO": true } } }`
- Operator fills in by hand by reading the source
- Tests will fail until filled in — this is the forcing function

Do **not** ship a "best-effort" partial extraction silently — it'll cause test failures with confusing coordinate diffs.
