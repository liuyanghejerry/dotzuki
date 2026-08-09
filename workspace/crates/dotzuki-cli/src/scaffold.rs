//! `jrpg new` — lay out a fresh zero-Rust game project.
//!
//! The layout mirrors the editor's scaffolder
//! (`tools/dotzuki-editor/server/scaffold.ts`, "empty" template) plus the `game`
//! section from `docs/game-project-spec.md`, so projects round-trip: the
//! editor opens `jrpg new` output, and editor-wizard projects pass
//! `jrpg check`.

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use serde_json::json;

use crate::manifest::{Activity, GameSection, Manifest};

// A minimal scene so a fresh project has something openable on day one.
// Same structure as the editor's starter scene.
const MAIN_SCENE: &str = r#"// main.scene — your game's first scene, written in the jrpg Game DSL.
// Scenes compile to JavaScript and run on the dotzuki-engine runtime; ask the
// in-editor AI assistant (✨) to sketch characters, quests and scenes for you.

game_scene Main {
    @storylines {
        @speaker("Guide") {
            "Welcome to your new JRPG project!"
            "Edit assets/scenes/main.scene to make it yours."
        }
    }
}
"#;

fn readme(title: &str) -> String {
    format!(
        r#"# {title}

A JRPG project created with `jrpg new`.

## Layout

- `.dotzuki-editor.json` — editor project config (activities, data roots)
- `data/` — game data: maps, data tables, the shared tile library, the
  narrative bible (`data/stories/`)
- `gfx/` — graphics assets (tilesets, sprites)
- `assets/scenes/` — Game DSL scene scripts (`.scene`)

## Editing

Reopen this folder from the editor's welcome screen (**Open Project**), or
start the editor with `JRPG_PROJECT_ROOT=<this folder>`.

## Checking

Run `jrpg check <this folder>` to compile-check every DSL file in the project.
"#
    )
}

/// Activity list written into `.dotzuki-editor.json` — the same six the editor
/// scaffolds (map/script/data/story/assets/tiles), with the same config
/// shapes and order.
fn activities() -> Vec<Activity> {
    let activity = |id: &str, kind: &str, label: &str, icon: &str, config: serde_json::Value| {
        Activity {
            id: id.to_string(),
            kind: kind.to_string(),
            label: label.to_string(),
            icon: icon.to_string(),
            enabled: true,
            config,
        }
    };
    vec![
        activity("maps", "map", "Maps", "map", json!({ "mapsDir": "maps" })),
        activity(
            "scripts",
            "script",
            "Scripts",
            "code",
            json!({ "scriptsDir": "maps", "extension": ".scene" }),
        ),
        activity("play", "play", "Play", "play", json!({})),
        activity("data", "data", "Data", "database", json!({ "tables": [] })),
        activity(
            "story",
            "story",
            "Story",
            "book",
            json!({ "storiesDir": "stories", "scenesDir": "maps", "locales": ["en", "zh"] }),
        ),
        activity("assets", "assets", "Assets", "image", json!({ "roots": ["gfx"] })),
        activity(
            "tiles",
            "tiles",
            "Tiles",
            "tiles",
            json!({ "tilesDir": "tiles", "tileSize": 16, "backdropMapsDir": "maps" }),
        ),
    ]
}

fn manifest(title: &str) -> Manifest {
    Manifest {
        name: title.to_string(),
        data_root: "./data".to_string(),
        gfx_root: Some("./gfx".to_string()),
        activities: activities(),
        game: Some(GameSection {
            entry_scene: Some("main".to_string()),
            entry_map: None,
            scenes_dir: Some("assets/scenes".to_string()),
        }),
        battle: None,
        shop: None,
    }
}

/// Directory names must be slugs: `^[a-z0-9][a-z0-9-]*$`.
pub fn is_slug(name: &str) -> bool {
    !name.is_empty()
        && name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        && !name.starts_with('-')
}

/// Scaffold a new project `<parent>/<name>`; returns the project directory.
pub fn run(name: &str, parent: Option<&Path>, title: Option<&str>) -> Result<PathBuf> {
    if !is_slug(name) {
        bail!(
            "invalid project name '{}': must match [a-z0-9][a-z0-9-]* \
             (use --title for a free-form display name)",
            name
        );
    }
    let parent = parent.unwrap_or_else(|| Path::new("."));
    let target = parent.join(name);
    if target.is_file() {
        bail!("target '{}' already exists and is a file", target.display());
    }
    if target.is_dir() && target.read_dir()?.next().is_some() {
        bail!(
            "target directory '{}' already exists and is not empty",
            target.display()
        );
    }

    let title = title.unwrap_or(name);
    let manifest_json = serde_json::to_string_pretty(&manifest(title))?;

    // Same footprint as the editor's empty template: data roots + gfx +
    // the story-bible skeleton + one starter scene + README.
    for dir in [
        "data/maps",
        "data/tiles",
        "data/stories/characters",
        "data/stories/quests",
        "data/stories/arcs",
        "gfx",
        "assets/scenes",
    ] {
        fs::create_dir_all(target.join(dir))
            .with_context(|| format!("failed to create {}/{}", target.display(), dir))?;
    }
    fs::write(target.join(".dotzuki-editor.json"), manifest_json)?;
    fs::write(target.join("assets/scenes/main.scene"), MAIN_SCENE)?;
    fs::write(target.join("README.md"), readme(title))?;

    println!("Created new JRPG project '{}' in {}", title, target.display());
    println!("  .dotzuki-editor.json");
    println!("  data/maps/  data/tiles/  gfx/");
    println!("  assets/scenes/main.scene");
    println!("  README.md");
    println!("Next: open the folder in dotzuki-editor, or run `jrpg check {}`.", target.display());

    Ok(target)
}
