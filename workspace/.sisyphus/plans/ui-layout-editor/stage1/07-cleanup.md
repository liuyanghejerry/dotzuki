# Step 1.7 — Stage 1 Cleanup & Exit Gate

After every menu has been migrated, lock in Stage 1 by enforcing invariants that prevent regression. This step is **not** optional — without these gates, future menu code can quietly reintroduce hardcoded layouts and silently break editor coverage.

## Cleanup Tasks

### 1. Delete Dead Helpers

Any pre-existing functions in `pokered-ui` that exist only to compute hardcoded layout numbers (e.g. `fn mart_main_menu_rect() -> TileRect`) should now be **dead code** and deleted. Run:

```bash
cargo +nightly udeps -p pokered-ui    # if installed
# or manually:
cargo clippy -p pokered-ui -- -W dead_code
```

Delete every flagged item. If something is "almost dead" (one caller in tests), inline it.

### 2. Remove Seed Script

`tools/seed_ui_layouts.py` was a one-shot bootstrap. **Delete it.** Keeping it implies it's safe to re-run, but re-running would overwrite hand-tuned JSON. The git history preserves it if anyone ever needs to re-seed from a different source.

```bash
git rm tools/seed_ui_layouts.py
```

### 3. Document the Workflow

Add to `crates/pokered-ui/README.md` (create if missing):

```markdown
## Layout Editing Workflow

UI layouts live in `crates/pokered-data/ui_layouts/*.json`. To change a menu layout:

1. Edit the JSON file directly OR use the visual editor (`tools/game-editor`, "UI Layout" activity)
2. Run `cargo build` — `pokered-data/build.rs` regenerates `OUT_DIR/ui_layouts_gen.rs`
3. Run `cargo test --workspace` — verify nothing broke

**Do NOT** add `TileRect::new(...)` literals to menu draw functions. All static layout data
must live in JSON. Dynamic computation (cursor position from state, hp_bar fill, dynamic text)
stays in code.
```

## Enforcement Gates (Permanent CI Checks)

### Gate 1: No `TileRect::new` in menu sources

Add to CI (or a `cargo xtask` rule):

```bash
#!/bin/bash
# tools/ci/check-no-hardcoded-layouts.sh
set -e
HITS=$(grep -rn 'TileRect::new' crates/pokered-ui/src/menus/ || true)
if [ -n "$HITS" ]; then
    echo "ERROR: TileRect::new() found in menu sources — must come from layout JSON"
    echo "$HITS"
    exit 1
fi
```

### Gate 2: No string-literal label text in menu sources

```bash
HITS=$(grep -rn 'frame\.label([^,]*,[^,]*,[[:space:]]*"' crates/pokered-ui/src/menus/ || true)
if [ -n "$HITS" ]; then
    echo "ERROR: Hardcoded label text found in menu sources — must come from layout JSON"
    echo "$HITS"
    exit 1
fi
```

(Allow `&format!(...)` and variable arguments — only literal strings are forbidden.)

### Gate 3: Schema version check

Already enforced in `build.rs` via the panic on `schema_version != 1`. No additional CI needed.

### Gate 4: Tests still byte-identical

```bash
cargo test --workspace    # must include the existing 2,446 tests, all green
```

If anyone modifies layout JSON in a PR, the assertion-based menu tests will catch behavioral differences. PR reviewers should look for unexpected test diffs.

## Add CI Job

`.github/workflows/main.yml` (or equivalent):

```yaml
- name: Layout invariants
  run: |
    bash tools/ci/check-no-hardcoded-layouts.sh
    cargo build -p pokered-data    # codegen runs
    cargo test --workspace
    cargo clippy --workspace -- -D warnings
```

## Stage 1 Exit Gate (ALL must be true)

- [ ] All 15 menu modules migrated (groups A through D from step 1.6)
- [ ] `grep -rn 'TileRect::new' crates/pokered-ui/src/menus/` → 0 results
- [ ] `grep -rn 'frame\.label([^,]*,[^,]*,[[:space:]]*"' crates/pokered-ui/src/menus/` → 0 results
- [ ] All seeded JSON files exist in `crates/pokered-data/ui_layouts/`, all have `schema_version: 1`
- [ ] `cargo build --workspace` succeeds (codegen produces valid Rust)
- [ ] `cargo test --workspace` green — **all 2,446 tests pass with zero assertion changes**
- [ ] `cargo clippy --workspace -- -D warnings` clean
- [ ] CI job added enforcing layout invariants
- [ ] Manual smoke test of game: visit mart, party, bag, naming, stats, battle — all visually identical to pre-Stage-1 baseline
- [ ] Seed script deleted; README updated

## What Success Looks Like

After Stage 1, a designer who knows nothing about Rust can:

1. Open `crates/pokered-data/ui_layouts/mart.json`
2. Change `"tw": 10` to `"tw": 12`
3. Run `cargo run`
4. See the mart menu is now 2 tiles wider — without touching any `.rs` file

That's the prerequisite for Stage 2 (wasm preview) and Stage 3 (visual editor) to deliver value.

## What Failure Looks Like (Roll Back If You See This)

- "I added a `code_override` field for naming.rs because the keyboard was tricky"
- "I kept `TileRect::new(...)` in stats.rs because I couldn't figure out the brackets"
- "I had to change a few test assertions because the values were slightly off"

Any of these means the schema is incomplete or the migration cut corners. Stage 2 and 3 will inherit the gaps. **Do not advance to Stage 2 if any exit-gate item fails.**

## Effort Sizing

Cleanup + CI + verification: **0.5 days**.

## Total Stage 1 Effort

| Substep | Effort |
|---------|--------|
| 1.1 schema seed script | 0.5 day |
| 1.2 Rust types | 0.25 day |
| 1.3 codegen (build.rs) | 1 day |
| 1.4 migrate main.rs (validation) | 0.25 day |
| 1.5 migrate mart.rs (stress test) | 1 day |
| 1.6 migrate remaining 13 menus | 2.5 days |
| 1.7 cleanup & gates | 0.5 day |
| **Total** | **~6 days** |

Plus 1-2 days slack for schema-gap discoveries during 1.5 / 1.6.
