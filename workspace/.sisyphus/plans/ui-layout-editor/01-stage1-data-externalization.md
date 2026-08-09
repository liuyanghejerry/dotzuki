# Stage 1 — Data Externalization

Move all hardcoded `TileRect::new(...)`, label texts, cursor positions, list params, and primitive coordinates from `crates/pokered-ui/src/menus/*.rs` into JSON files under `crates/pokered-data/ui_layouts/`, with `build.rs` codegen producing static Rust structs.

## Sub-Plans

| Step | Scope | File |
|------|-------|------|
| 1.0 | JSON schema design (what's externalized vs. what stays in code) | [`stage1/00-schema.md`](./stage1/00-schema.md) |
| 1.1 | Extract script: parse menus → seed initial JSON | [`stage1/01-extract-script.md`](./stage1/01-extract-script.md) |
| 1.2 | Schema Rust types in `pokered-data` | [`stage1/02-rust-types.md`](./stage1/02-rust-types.md) |
| 1.3 | `build.rs` codegen | [`stage1/03-codegen.md`](./stage1/03-codegen.md) |
| 1.4 | Migrate `main.rs` (simplest, prototype) | [`stage1/04-migrate-main.md`](./stage1/04-migrate-main.md) |
| 1.5 | Migrate `mart.rs` (most complex) | [`stage1/05-migrate-mart.md`](./stage1/05-migrate-mart.md) |
| 1.6 | Migrate remaining 9 menus | [`stage1/06-migrate-rest.md`](./stage1/06-migrate-rest.md) |
| 1.7 | Cleanup + final test sweep | [`stage1/07-cleanup.md`](./stage1/07-cleanup.md) |

## Stage Verification (must pass before Stage 2 begins)

```bash
cargo test --workspace                                   # all 2,446 tests green
! grep -rn 'TileRect::new' crates/pokered-ui/src/menus/  # no hardcoded coords remain
ls crates/pokered-data/ui_layouts/*.json | wc -l         # == 15 files (one per menu module)
```

## Critical Constraints

1. **Byte-for-byte test preservation**: The `Recorder`-based tests in `crates/pokered-ui/tests/menus.rs` must pass with **zero assertion changes**. Any divergence between hardcoded values and seeded JSON values is a bug in the extract script (1.1).
2. **No layout-injection coupling in callers**: Menu draw functions take `layout: &XxxLayout` as a parameter. Callers obtain layouts from the generated registry and pass them in. **Do not** make menu modules `use SOME_GLOBAL_STATIC` directly — that breaks the wasm preview's ability to inject editor-modified layouts (see `04-risks-and-decisions.md` §Decision 2).
3. **Schema versioning**: Every JSON file must include `"schema_version": 1` at the top level. `build.rs` rejects unknown versions.

## Order Discipline

Steps must be done in numerical order. **Do NOT** start 1.4 (migration) before 1.3 (codegen) is verified, because the migration can't compile without the generated types.

The de-risking prototype from `00-overview.md` corresponds roughly to steps 1.0 → 1.2 → 1.3 → 1.4 (skipping 1.1 — seed `main.json` by hand for the prototype).
