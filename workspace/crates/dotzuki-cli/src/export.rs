//! `dotzuki export --web` — pack a zero-Rust game project into a static web
//! directory that any static file server can host:
//!
//! ```text
//! <out>/
//! ├── index.html                      (player page: canvas + input + audio + saves)
//! ├── game.bundle.json                ({ dotzuki: {…meta}, files: {path: base64} })
//! └── wasm/
//!     ├── dotzuki_runner_web.js       (wasm-pack glue)
//!     └── dotzuki_runner_web_bg.wasm  (the runner itself)
//! ```
//!
//! The page boots the same `WasmRunner` (dotzuki-runner-web) the editor's Play
//! activity uses, so an exported game plays identically to the in-editor
//! playtest. Pipeline: validate (`dotzuki check` diagnostics; `--force`
//! overrides) → collect the bundle → locate/build the runner wasm package →
//! write the three artifacts.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};

use crate::{bundle, check, runner_pkg};

/// CLI arguments for `dotzuki export --web`.
pub struct ExportArgs {
    /// Project root containing `.dotzuki-editor.json`.
    pub dir: PathBuf,
    /// Output directory (default: `<project>/dist/web` — `dist` is excluded
    /// from bundles, so re-exporting never packs a previous export).
    pub out: Option<PathBuf>,
    /// Prebuilt dotzuki-runner-web wasm package directory override.
    pub runner_pkg: Option<PathBuf>,
    /// Rebuild the wasm package with wasm-pack even when a prebuilt one exists.
    pub rebuild_runner: bool,
    /// Export despite DSL/battle diagnostics.
    pub force: bool,
}

const INDEX_TEMPLATE: &str = include_str!("../templates/web-player.html");

/// Export the project and return the output directory.
pub fn run(args: &ExportArgs) -> Result<PathBuf> {
    // 1. Validate — the same diagnostics `dotzuki check` reports.
    let diags = gate_diagnostics(&args.dir, args.force)?;

    // 2. Bundle the project files.
    let files = bundle::collect_project_files(&args.dir).context("failed to collect project files")?;

    // 3. Locate (or wasm-pack build) the runner package.
    let pkg = runner_pkg::locate(args.runner_pkg.as_deref(), args.rebuild_runner)?;

    // 4. Write the static site.
    let out = args
        .out
        .clone()
        .unwrap_or_else(|| args.dir.join("dist").join("web"));
    write_site(&out, &diags.manifest.name, &files, &pkg)?;

    let bundle_bytes = fs::metadata(out.join("game.bundle.json")).map(|m| m.len()).unwrap_or(0);
    println!(
        "exported {} file(s) ({:.1} MiB bundle) to {}",
        files.len(),
        bundle_bytes as f64 / (1024.0 * 1024.0),
        out.display()
    );
    println!("serve it with any static file server, e.g.:");
    println!("  python3 -m http.server --directory {}", out.display());
    Ok(out)
}

/// Validate a project for export: the same diagnostics `dotzuki check`
/// reports, blocking the export unless `force` — shared by every export
/// target (`--web`, `--native`).
pub fn gate_diagnostics(dir: &Path, force: bool) -> Result<check::ProjectDiagnostics> {
    let diags = check::diagnose(dir)?;
    if diags.total() > 0 {
        for d in diags.all() {
            eprintln!("error: {d}");
        }
        if !force {
            bail!(
                "export aborted: {} diagnostic(s) — fix them (see `dotzuki check`) or pass --force",
                diags.total()
            );
        }
        eprintln!(
            "warning: exporting despite {} diagnostic(s) (--force)",
            diags.total()
        );
    }
    Ok(diags)
}

/// Write `index.html` + `game.bundle.json` + `wasm/*` into `out`.
fn write_site(
    out: &Path,
    title: &str,
    files: &BTreeMap<String, String>,
    pkg: &Path,
) -> Result<()> {
    let wasm_dir = out.join("wasm");
    fs::create_dir_all(&wasm_dir)
        .with_context(|| format!("failed to create {}", wasm_dir.display()))?;
    for file in [runner_pkg::JS_FILE, runner_pkg::WASM_FILE] {
        fs::copy(pkg.join(file), wasm_dir.join(file))
            .with_context(|| format!("failed to copy {file} from {}", pkg.display()))?;
    }

    fs::write(out.join("game.bundle.json"), bundle::serialize_bundle(files)?)
        .context("failed to write game.bundle.json")?;

    let html = render_index_html(title, &save_key(title));
    fs::write(out.join("index.html"), html).context("failed to write index.html")?;
    Ok(())
}

/// The localStorage key the player page persists saves under.
fn save_key(title: &str) -> String {
    format!("dotzuki-save:{title}")
}

/// Fill the player-page template. The title is HTML-escaped into `<title>` and
/// `<h1>`; the save key is JSON-encoded (a valid JS string literal).
fn render_index_html(title: &str, save_key: &str) -> String {
    let escaped = html_escape(title);
    let key_json = serde_json::to_string(save_key).unwrap_or_else(|_| "\"dotzuki-save\"".into());
    INDEX_TEMPLATE
        .replace("__DOTZUKI_TITLE__", &escaped)
        .replace("__DOTZUKI_SAVE_KEY__", &key_json)
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::*;
    use dotzuki_runner::vfs::MemoryFiles;
    use dotzuki_runner::{run_headless, HeadlessOptions, LoadedProject, RunnerGame, RunnerOptions};
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Arc;

    static NEXT_ID: AtomicU32 = AtomicU32::new(0);

    /// Unique temp directory, removed on drop.
    struct TestDir(PathBuf);

    impl TestDir {
        fn new(test: &str) -> Self {
            let id = NEXT_ID.fetch_add(1, Ordering::SeqCst);
            let dir = std::env::temp_dir().join(format!(
                "dotzuki-cli-export-{test}-{}-{id}",
                std::process::id()
            ));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            TestDir(dir)
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    /// A fake runner wasm package (two placeholder files) for tests that must
    /// not depend on wasm-pack.
    fn fake_runner_pkg(test: &str) -> TestDir {
        let tmp = TestDir::new(test);
        fs::write(tmp.0.join(runner_pkg::JS_FILE), "// test stub").unwrap();
        fs::write(tmp.0.join(runner_pkg::WASM_FILE), b"\0asm").unwrap();
        tmp
    }

    /// The tutorial project shipped in this repo.
    fn example_project() -> Option<PathBuf> {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/your-first-game");
        dir.is_dir().then_some(dir)
    }

    fn args(dir: PathBuf, out: PathBuf, pkg: &Path, force: bool) -> ExportArgs {
        ExportArgs {
            dir,
            out: Some(out),
            runner_pkg: Some(pkg.to_path_buf()),
            rebuild_runner: false,
            force,
        }
    }

    #[test]
    fn export_produces_a_bootable_site() {
        let Some(project) = example_project() else {
            eprintln!("skipping: examples/your-first-game not present");
            return;
        };
        let pkg = fake_runner_pkg("site-pkg");
        let tmp = TestDir::new("site");
        let out = export_dir(&tmp);
        let produced = run(&args(project, out.clone(), &pkg.0, false)).unwrap();
        assert_eq!(produced, out);

        // The three artifacts exist.
        let html = fs::read_to_string(out.join("index.html")).unwrap();
        let bundle: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(out.join("game.bundle.json")).unwrap(),
        )
        .unwrap();
        assert!(out.join("wasm").join(runner_pkg::JS_FILE).is_file());
        assert!(out.join("wasm").join(runner_pkg::WASM_FILE).is_file());

        // Version metadata rides along (informational only).
        assert_eq!(
            bundle["dotzuki"]["version"].as_str().unwrap(),
            env!("CARGO_PKG_VERSION")
        );

        // The page wired the manifest name into title and save key.
        assert!(html.contains("Your First Game"), "{html}");
        assert!(html.contains("dotzuki-save:Your First Game"), "{html}");

        // The bundle boots through the exact WasmRunner path: decode the
        // base64 map into MemoryFiles and drive a few frames headless.
        let encoded: std::collections::HashMap<String, String> =
            serde_json::from_value(bundle["files"].clone()).unwrap();
        assert!(encoded.contains_key(".dotzuki-editor.json"));
        let decoded: std::collections::HashMap<String, Vec<u8>> = encoded
            .into_iter()
            .map(|(k, v)| {
                use base64::Engine as _;
                let bytes = base64::engine::general_purpose::STANDARD.decode(v).unwrap();
                (k, bytes)
            })
            .collect();
        let project = LoadedProject::load_with_files(Arc::new(MemoryFiles::new(decoded))).unwrap();
        let mut game = RunnerGame::new(
            project,
            RunnerOptions {
                headless: true,
                pcm_audio: true,
                fresh: true,
                ..RunnerOptions::default()
            },
        )
        .unwrap();
        run_headless(&mut game, &HeadlessOptions {
            frames: 30,
            ..HeadlessOptions::default()
        })
        .unwrap();
    }

    #[test]
    fn dsl_errors_block_export_unless_forced() {
        let tmp = TestDir::new("broken");
        let root = tmp.0.join("proj");
        fs::create_dir_all(root.join("assets/scenes")).unwrap();
        fs::write(
            root.join(".dotzuki-editor.json"),
            r#"{ "name": "broken", "dataRoot": "./data" }"#,
        )
        .unwrap();
        fs::write(root.join("assets/scenes/bad.scene"), "this is not a scene {{{").unwrap();

        let pkg = fake_runner_pkg("broken-pkg");
        let err = run(&args(root.clone(), export_dir(&tmp), &pkg.0, false)).unwrap_err();
        assert!(err.to_string().contains("--force"), "{err}");

        // --force exports anyway.
        let out = run(&args(root, export_dir(&tmp), &pkg.0, true)).unwrap();
        assert!(out.join("game.bundle.json").is_file());
    }

    #[test]
    fn missing_project_is_an_error() {
        let tmp = TestDir::new("missing");
        let pkg = fake_runner_pkg("missing-pkg");
        let err = run(&args(tmp.0.join("nope"), export_dir(&tmp), &pkg.0, false)).unwrap_err();
        assert!(err.to_string().contains(".dotzuki-editor.json"), "{err}");
    }

    fn export_dir(tmp: &TestDir) -> PathBuf {
        tmp.0.join(format!("out-{}", NEXT_ID.fetch_add(1, Ordering::SeqCst)))
    }
}
