mod bundle;
mod check;
mod export;
mod run;
mod runner_pkg;
mod scaffold;
mod templates;

// The manifest model lives in dotzuki-runner (shared with the runtime); this
// re-export keeps `crate::manifest::…` paths in check/scaffold unchanged.
use dotzuki_runner::manifest;

use std::path::PathBuf;

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(
    name = "dotzuki",
    version,
    about = "dotzuki-engine game project tool — scaffold, check and run zero-Rust game projects"
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Scaffold a new game project (layout per docs/reference/project-manifest.md)
    New {
        /// Project directory name; must be a slug: [a-z0-9][a-z0-9-]*
        name: String,
        /// Parent directory for the new project (default: current directory)
        #[arg(long)]
        dir: Option<PathBuf>,
        /// Display name stored in the manifest (default: the slug)
        #[arg(long)]
        title: Option<String>,
        /// Project template: "empty" (default) or "your-first-game" (the
        /// tutorial project from docs/tutorials/your-first-game.md)
        #[arg(long)]
        template: Option<String>,
    },
    /// Compile-check a project's DSL files and report diagnostics
    Check {
        /// Project root containing .dotzuki-editor.json
        dir: PathBuf,
    },
    /// Export a project to a distributable form
    Export {
        /// Project root containing .dotzuki-editor.json
        dir: PathBuf,
        /// Export a static web site (index.html + game.bundle.json + wasm runner)
        #[arg(long, required = true)]
        web: bool,
        /// Output directory (default: <project>/dist/web)
        #[arg(long)]
        out: Option<PathBuf>,
        /// Use this prebuilt dotzuki-runner-web wasm package directory
        /// instead of the workspace one (no wasm-pack needed)
        #[arg(long)]
        runner_pkg: Option<PathBuf>,
        /// Rebuild the runner wasm package with wasm-pack even when a
        /// prebuilt one exists
        #[arg(long)]
        rebuild_runner: bool,
        /// Export even when DSL validation reports diagnostics
        #[arg(long)]
        force: bool,
    },
    /// Boot a game project and play it (windowed; --headless for CI)
    Run {
        /// Project root containing .dotzuki-editor.json
        dir: PathBuf,
        /// Map to spawn on (overrides the manifest's game.entryMap)
        #[arg(long)]
        map: Option<String>,
        /// UI/script language (@t bilingual text)
        #[arg(long, default_value = "en", value_parser = ["en", "zh"])]
        lang: String,
        /// Run without opening a window (smoke tests, screenshots)
        #[arg(long)]
        headless: bool,
        /// Headless: frames to simulate
        #[arg(long, default_value_t = 120)]
        frames: u32,
        /// Headless: dump the final frame to this PNG
        #[arg(long)]
        screenshot: Option<PathBuf>,
        /// Window scale factor
        #[arg(long, default_value_t = 3)]
        scale: u32,
        /// Hot-reload scenes and the current map as files change on disk
        /// (windowed mode only; ignored with --headless)
        #[arg(long)]
        watch: bool,
        /// Ignore an existing save file and start fresh
        #[arg(long)]
        fresh: bool,
        /// Save file location (default: <project>/.dotzuki-save.json)
        #[arg(long)]
        save_file: Option<PathBuf>,
        /// Headless: also write the save file (windowed runs always save)
        #[arg(long)]
        save: bool,
    },
}

fn main() -> anyhow::Result<()> {
    // A plain stderr logger: hot-reload events, save warnings and battle
    // diagnostics are otherwise silent (the log crate has no backend here).
    // `RUST_LOG` overrides the default "info" filter.
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    let cli = Cli::parse();
    match cli.command {
        Commands::New {
            name,
            dir,
            title,
            template,
        } => {
            scaffold::run(&name, dir.as_deref(), title.as_deref(), template.as_deref())?;
        }
        Commands::Check { dir } => check::run(&dir)?,
        Commands::Export {
            dir,
            web: _,
            out,
            runner_pkg,
            rebuild_runner,
            force,
        } => {
            export::run(&export::ExportArgs {
                dir,
                out,
                runner_pkg,
                rebuild_runner,
                force,
            })?;
        }
        Commands::Run {
            dir,
            map,
            lang,
            headless,
            frames,
            screenshot,
            scale,
            watch,
            fresh,
            save_file,
            save,
        } => run::run(run::RunArgs {
            dir,
            map,
            lang,
            headless,
            frames,
            screenshot,
            scale,
            watch,
            fresh,
            save_file,
            save,
        })?,
    }
    Ok(())
}
