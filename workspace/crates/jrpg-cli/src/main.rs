mod check;
mod run;
mod scaffold;

// The manifest model lives in jrpg-runner (shared with the runtime); this
// re-export keeps `crate::manifest::…` paths in check/scaffold unchanged.
use jrpg_runner::manifest;

use std::path::PathBuf;

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(
    name = "jrpg",
    version,
    about = "jrpg-engine game project tool — scaffold, check and run zero-Rust game projects"
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Scaffold a new game project (layout per docs/game-project-spec.md)
    New {
        /// Project directory name; must be a slug: [a-z0-9][a-z0-9-]*
        name: String,
        /// Parent directory for the new project (default: current directory)
        #[arg(long)]
        dir: Option<PathBuf>,
        /// Display name stored in the manifest (default: the slug)
        #[arg(long)]
        title: Option<String>,
    },
    /// Compile-check a project's DSL files and report diagnostics
    Check {
        /// Project root containing .jrpg-editor.json
        dir: PathBuf,
    },
    /// Boot a game project and play it (windowed; --headless for CI)
    Run {
        /// Project root containing .jrpg-editor.json
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
        /// Save file location (default: <project>/.jrpg-save.json)
        #[arg(long)]
        save_file: Option<PathBuf>,
        /// Headless: also write the save file (windowed runs always save)
        #[arg(long)]
        save: bool,
    },
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Commands::New { name, dir, title } => {
            scaffold::run(&name, dir.as_deref(), title.as_deref())?;
        }
        Commands::Check { dir } => check::run(&dir)?,
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
