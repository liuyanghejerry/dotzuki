# DSL Runtime Loading Reference

> - **Audience**: rust developers
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.5.4

The disk-backed [scene](../glossary.md) providers in
`dotzuki_engine_dsl::disk_loader`
(`crates/dotzuki-engine-dsl/src/disk_loader.rs`) compile `.scene` files from
a directory tree at runtime, with mtime-based [hot reload](../glossary.md).
This page defines the directory layout contract, the two providers, and the
reload protocol.

## What it is

`disk_loader` is the runtime counterpart of the build-time embedded path in
`crate::loader`: instead of `include!`-ing pre-compiled artifacts it
compiles `.scene` sources on the fly, so a game can point the engine at a
scripts directory (e.g. a `--scripts-dir` CLI flag) and iterate on scenes
without rebuilding. The module has no feature gate and builds on `std::fs`.

What a `.scene` file compiles to is the [codegen](../glossary.md) contract,
defined in [DSL codegen contract](./codegen.md); this page covers loading
those compilations from disk and keeping them current.

Two providers mirror the DSL's two execution targets
(disk_loader.rs:188-280):

| Provider | Execution target | Stores | `shared/` modules | `disk_mode` flag |
|---|---|---|---|---|
| `SceneAstProvider` | native AST [interpreter](../glossary.md) | `GameScene` ASTs | yes | yes |
| `SceneScriptProvider` | JavaScript engine | compiled JS source | no | no |

Neither provider has an in-repo consumer yet; they are game-facing API.
`dotzuki-runner` loads DSL scenes through `compiler::compile_files` +
`loader::register_compiled`, not through these providers. Plain `.js` files
have a separate loader, `dotzuki_engine_script::loader::ScriptLoader`, which
does not read `.scene` sources.

## Directory layout contract

The caller injects the root directory; the providers discover scenes under
it:

```
<dir>/
├── StartTown/
│   └── script.scene     # scene id "StartTown"
├── shared/
│   └── center.scene     # scene id "shared/center" (AST provider only)
└── notes.txt            # ignored
```

- `<dir>/<scene-id>/script.scene` — one scene per subdirectory; the scene id
  is the subdirectory name.
- `<dir>/shared/<name>.scene` — shared modules, registered under the scene
  id `shared/<name>`; the AST provider only.
- Non-`.scene` files and subdirectories without `script.scene` are ignored
  (verified by `ast_provider_loads_map_and_shared_scenes`, which loads a
  directory that also contains `notes.txt` and a scene-less `EmptyDir/`).

## `SceneAstProvider`

Disk provider for the native AST interpreter — no JavaScript engine
(disk_loader.rs:188-239). Quoted from disk_loader.rs:188-197:

```rust
pub struct SceneAstProvider {
    pub scenes: HashMap<String, GameScene>,
    pub file_meta: HashMap<String, SceneFileMeta>,
    pub disk_mode: bool,
}
```

Methods:

| Method | Returns | Meaning |
|---|---|---|
| `new()` | `Self` | Empty provider, `disk_mode == false` |
| `get_scene(map_id)` | `Option<&GameScene>` | Look up a compiled AST |
| `has_scene(map_id)` | `bool` | Presence check |
| `load_from_directory(dir)` | `Result<usize, String>` | Compile every discovered scene; scene count on success |
| `check_reload()` | `Vec<String>` | Recompile files whose mtime advanced; ids changed on disk |

`SceneFileMeta` records each tracked file's `path: PathBuf` and last-known
`modified: SystemTime` (disk_loader.rs:28-31).

### `disk_mode` shadowing

- `load_from_directory` sets `disk_mode = true` *before* it checks whether
  `dir` exists (disk_loader.rs:216-219). A missing or non-directory path
  returns `Ok(0)` — and still flips `disk_mode` on (verified by
  `ast_provider_missing_dir_loads_zero_but_enters_disk_mode`).
- When `disk_mode` is true, the provider came from a scripts directory and
  **shadows the embedded ASTs entirely** — all-or-nothing, mirroring the JS
  loader's convention.
- When false, `scenes` holds only runtime injections/overrides and misses
  fall back to the embedded ASTs.

## `SceneScriptProvider`

Disk provider for the JavaScript script path (disk_loader.rs:244-280), with
the same method shape as the AST provider, except:

- `scenes: HashMap<String, String>` stores compiled JS source;
  `get_script(map_id)` returns `Option<&str>` (`has_script` is the presence
  check).
- There is no `disk_mode` field.
- The `shared/` directory is not consulted — the JS path has no
  shared-module convention (verified by
  `script_provider_loads_js_and_ignores_shared_dir`).

## Loading semantics

`load_from_directory(dir)` (disk_loader.rs:118-141, 216-234, 265-275):

- A missing or non-directory `dir` returns `Ok(0)` — but see the
  `disk_mode` ordering above for the AST provider.
- The AST provider compiles shared files first, then map scenes.
- The first read or compile error aborts the whole batch; the error string
  names the offending file.

## Hot reload protocol

`check_reload()` (disk_loader.rs:147-182):

- Recompiles every tracked file whose on-disk mtime has **strictly
  advanced** since it was loaded.
- Files that fail to re-read or recompile **keep their previous version**;
  the tracked mtime advances only on a successful recompile, so a failed
  file is retried on the next call.
- The return value lists the ids of the scenes that **changed on disk**,
  whether or not the recompile succeeded. Callers must not treat the
  returned ids as "reloaded".
- A provider whose files are untouched reports no changes (verified by
  `check_reload_is_quiet_until_a_file_changes`); the JS provider follows the
  same protocol (verified by
  `script_provider_check_reload_recompiles_changed_files`).

## Examples

Loading a scripts directory that holds one map scene plus a shared module:

```rust
use std::path::Path;

use dotzuki_engine_dsl::disk_loader::SceneAstProvider;

let mut provider = SceneAstProvider::new();
let count = provider.load_from_directory(Path::new("assets/scripts")).unwrap();
assert_eq!(count, 2); // StartTown + shared/center
assert!(provider.disk_mode);
assert!(provider.has_scene("StartTown"));
assert!(provider.has_scene("shared/center"));
```

*Verified by `ast_provider_loads_map_and_shared_scenes` in
`crates/dotzuki-engine-dsl/src/disk_loader.rs`.*

Polling for changes after a scene file was edited on disk:

```rust
let mut provider = SceneAstProvider::new();
provider.load_from_directory(Path::new("assets/scripts")).unwrap();

// Later, after `StartTown/script.scene` changed on disk:
let changed = provider.check_reload();
assert_eq!(changed, vec!["StartTown".to_string()]);
let town = provider.get_scene("StartTown").expect("StartTown AST");
assert!(town.storylines.iter().any(|s| s.name == "intro_v2"));
// The tracked mtime now matches the file, so the next poll is quiet.
assert!(provider.check_reload().is_empty());
```

*Verified by `ast_provider_check_reload_recompiles_changed_files` in
`crates/dotzuki-engine-dsl/src/disk_loader.rs`.* The test forces the tracked
mtime to `SystemTime::UNIX_EPOCH` before rewriting the file, to defeat
filesystem timestamp granularity.

## Gotchas

- **First error aborts the batch.** One unreadable or uncompilable file
  fails the entire `load_from_directory` call.
- **wasm32 `disk_mode` trap.** The module is ungated but `std::fs`-based; on
  wasm32 `is_dir()` is false, so `load_from_directory` returns `Ok(0)` — and
  the AST provider still enters `disk_mode`, shadowing *all* embedded ASTs
  with nothing. There is no `#[cfg]` shielding (unlike
  `dotzuki-engine-script`'s loader, which is cfg-gated `not(wasm32)`).
  Guard the call site when the same code also builds for a
  [WASM runner](../glossary.md) target.
- **AST/JS asymmetry.** `shared/` modules and the `disk_mode` flag exist
  only on the AST provider; the JS provider compiles map scenes only.
