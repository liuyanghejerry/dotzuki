# Outward spiral regression captures

The capture fixture renders the same 160×144 tile grid with the same public
`BattleTransitionState` entry point before and after the fix. Each update is
one batch of three writes. Files are paired at updates 1, 12, 60 and 120.

Before: `dotzuki@67d7f0a`, linked from the immutable pre-fix consumer rlib.
After: the changed renderer in this PR, built from this worktree.
`capture.rs` emits PPM pixels; Pillow converts these losslessly to PNG.

Before, `is_done()` remains false at 120 and beyond, leaving a consumer's
first move waiting forever after the introduction. After, the first two
batches match the independently traced direction changes and update 120
ends with the full black screen. The original source reference is
`pret/pokered@fbcf7d0`, `engine/battle/battle_transitions.asm:186–205,262–326`.
These are generic renderer captures, not ROM screenshots.
