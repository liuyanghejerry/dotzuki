mod game;

use std::path::PathBuf;

use clap::Parser;
use firered_data::{GBA_SCREEN_HEIGHT, GBA_SCREEN_WIDTH};
use jrpg_app::{run, GameWindowConfig};
use jrpg_engine::render::{FrameBuffer, Rgba};
use jrpg_engine::render_config::RenderConfig;
use jrpg_renderer::input::{GbButton, InputState};
use jrpg_renderer::window::GameLoop;

use crate::game::FireRedGame;

#[derive(Parser)]
#[command(name = "firered", about = "Pokémon FireRed — Pallet Town overworld")]
struct Cli {
    /// Window scale factor (1-6, default: 3 for GBA resolution).
    #[arg(long, default_value = "3")]
    scale: u32,

    /// Headless: render to a PNG and exit (no window).
    #[arg(long)]
    screenshot: Option<PathBuf>,

    /// With --screenshot: simulate this many update frames before capturing.
    #[arg(long, default_value = "0")]
    frames: u32,

    /// With --screenshot: hold a direction while stepping (up/down/left/right).
    #[arg(long)]
    hold: Option<String>,

    /// With --screenshot: show the collision/tile debug overlay.
    #[arg(long)]
    debug: bool,

    /// With --screenshot: skip the top-layer-over-player pass (walk-behind off).
    #[arg(long)]
    skip_top: bool,

    /// With --screenshot: spawn the player at metatile "X,Y".
    #[arg(long)]
    spawn: Option<String>,
}

fn main() {
    env_logger::init();

    let cli = Cli::parse();

    if let Some(path) = cli.screenshot {
        screenshot(
            &path,
            cli.frames,
            cli.hold.as_deref(),
            cli.debug,
            cli.skip_top,
            cli.spawn.as_deref(),
        );
        return;
    }

    let config = GameWindowConfig {
        title: "Pokémon FireRed — Pallet Town".to_string(),
        scale: cli.scale,
        resizable: true,
        width: GBA_SCREEN_WIDTH,
        height: GBA_SCREEN_HEIGHT,
    };

    let game = FireRedGame::new();

    match run(config, game) {
        Ok(()) => println!("FireRed overworld exited normally"),
        Err(e) => eprintln!("Error: {}", e),
    }
}

/// Headless render harness for visual verification.
fn screenshot(
    path: &PathBuf,
    frames: u32,
    hold: Option<&str>,
    debug: bool,
    skip_top: bool,
    spawn: Option<&str>,
) {
    let mut game = FireRedGame::new();
    game.overlay_top = !skip_top;
    if let Some(s) = spawn {
        if let Some((x, y)) = s.split_once(',') {
            if let (Ok(x), Ok(y)) = (x.trim().parse(), y.trim().parse()) {
                game.teleport(x, y);
            }
        }
    }
    let mut input = InputState::new();

    let held = hold.and_then(|h| match h.to_ascii_lowercase().as_str() {
        "up" => Some(GbButton::Up),
        "down" => Some(GbButton::Down),
        "left" => Some(GbButton::Left),
        "right" => Some(GbButton::Right),
        _ => None,
    });
    if debug {
        // Toggle the overlay once via a Select just-press.
        input.begin_frame();
        input.press(GbButton::Select);
        game.update(&input);
        input.release(GbButton::Select);
    }
    if let Some(b) = held {
        input.press(b);
    }
    for _ in 0..frames {
        input.begin_frame();
        game.update(&input);
    }

    let mut fb = FrameBuffer::new(
        RenderConfig::new(GBA_SCREEN_WIDTH, GBA_SCREEN_HEIGHT),
        Rgba::BLACK,
    );
    game.draw(&mut fb);
    match fb.save_png(path) {
        Ok(()) => println!("wrote {}", path.display()),
        Err(e) => eprintln!("failed to write {}: {e}", path.display()),
    }
}
