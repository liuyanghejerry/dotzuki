//! The `dotzuki run` game runtime: [`RunnerGame`].
//!
//! [`RunnerGame`] boots a [`LoadedProject`] into a playable game with **zero
//! game-specific code**: an overworld driven by the generic
//! [`OverworldActor`], storyline dispatch from the DSL routing table
//! (`@trigger` declarations), a scene-pumping VM on top of
//! [`ScriptEngine`] (one short-lived engine per scene activation, the wuxia
//! pattern), textbox/choice UI from `dotzuki-ui`, and placeholder sprites drawn
//! procedurally (no embedded assets).
//!
//! # State machine
//!
//! ```text
//! Overworld ──A on NPC──▶ Text ──last page + A──▶ (pump) ──▶ Overworld
//!    │                     ▲   │ ShowChoice        │ next command
//!    │step onto warp       │   ▼                   ▼
//!    │                     └── Choice ──A──▶ signal_done(Number) ──▶ (pump)
//!    │Start
//!    ▼
//! Menu (party / bag / save) ──B/Start──▶ Overworld
//! WarpTransition (fade out → load map → fade in → opening dispatch)
//! ```
//!
//! A [`Mode::Delay`] suspends the scene for N frames. `Mode::Idle` is the
//! resting state of a map-less (dialogue-only) project once its entry scene
//! has finished.
//!
//! # Scene dispatch rules
//!
//! On entering a map (boot or warp), after any fade-in:
//!
//! 1. every `on_enter` route for the map fires, sequentially;
//! 2. else the map scene's `<SceneName>OnLoad` (from `@load`) runs;
//! 3. else the map scene's storyline `main` plays once, guarded by the
//!    `__played_main_<map>` flag.
//!
//! Talking to an NPC tries, in order: the NPC's `talk` field as a storyline
//! name, a route whose `npc` matches the NPC's name/id, the map scene's
//! `main`, and finally the `talk` field shown as a raw one-off line.
//!
//! # Command handling
//!
//! v1 handles `ShowText`, `ShowChoice`, `Delay`, `WarpTo`, `FadeScreen`,
//! `SetFlag`/`ResetFlag`/`CheckFlag` and the audio commands (played through
//! [`RunnerAudio`] when the project ships `data/audio/` tracks and a device
//! is available; silent no-ops otherwise). `StartBattle`/`StartWildBattle`
//! suspend the scene and arm the generic battle system ([`crate::battle`])
//! when the manifest has a `battle` section — otherwise they auto-complete
//! with `"win"` like any unimplemented command; a lost battle arms the
//! game-over whiteout (see [`menu`]). `OpenShop` suspends the scene and
//! opens the buy-only shop UI. Any other command logs a loud warning and is
//! auto-completed with `Void` — an unimplemented command must never deadlock
//! the scene VM.
//!
//! # Menus, shops, game-over
//!
//! Start in the overworld opens the pause menu (party view / bag / save);
//! the scene `openShop` command opens a buy-only shop; losing a battle
//! triggers the whiteout (heal + return to the entry spawn). All three live
//! in the [`menu`] child module; money is runner-owned, seeded from the
//! manifest's `shop` section and carried in the v3 save.
//!
//! # Random encounters
//!
//! A map's objects sidecar may carry an `encounters` block (`{rate, zones}`
//! — pokered `wild_data`-shaped, `rate` in /256 per-step units). A completed
//! walk step onto a zoned tile rolls once; a hit picks a weighted id from
//! the zone's table and arms a **sceneless** battle (no scene suspended —
//! win/run returns to the overworld in place, a loss goes straight to the
//! whiteout). Warp tiles take priority over the roll on the same tile.

#[cfg(all(feature = "watch", not(target_arch = "wasm32")))]
use std::collections::HashSet;
use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use dotzuki_engine::camera::{Camera, Rect, Vec2};
use dotzuki_engine::menu::MenuConfig;
use dotzuki_engine::overworld::actor::{frame_col, OverworldActor, OverworldCollision};
use dotzuki_engine::overworld::types::Direction;
use dotzuki_engine::render::{FrameBuffer, Rgba, TileRect, Ui};
use dotzuki_engine_script::command::{CommandResult, ScriptCommand};
use dotzuki_engine_script::engine::ScriptEngine;
use dotzuki_renderer::embedded_font;
use dotzuki_renderer::input::{GbButton, InputState};
use dotzuki_renderer::walk_sprite::WalkSprite;
use dotzuki_ui::widgets::{draw_dialog, draw_flex_menu, wrap_lines, FlexMenuState};
use dotzuki_ui::FrameBufferPainter;

use crate::audio::RunnerAudio;
use crate::battle::{
    Battle, BattleOutcome, BattleRng, BattleSetup, PartyMemberState, ScriptedRng, XorshiftRng,
};
use crate::manifest::DEFAULT_START_MONEY;
use crate::map::RuntimeMap;
use crate::project::LoadedProject;
use crate::save::{GameSave, PartyMemberSave, PlayerSave, DEFAULT_SAVE_FILE, SAVE_VERSION};
use crate::vfs::join_path;
#[cfg(all(feature = "watch", not(target_arch = "wasm32")))]
use crate::watch::ProjectWatcher;

mod menu;
use menu::{MenuState, ShopState, WhiteoutState};

/// Logical framebuffer width (window mode and headless rendering).
pub const SCREEN_W: i32 = 320;
/// Logical framebuffer height.
pub const SCREEN_H: i32 = 240;

/// Fade frames per warp-transition phase (out / in).
const FADE_FRAMES: u32 = 10;
/// Cosmetic blackout frames for a `FadeScreen` command.
const FLASH_FRAMES: u32 = 10;
/// Frames to wait after applying a hot-reload batch before the next one —
/// coalesces editor save bursts into a single reload.
#[cfg(all(feature = "watch", not(target_arch = "wasm32")))]
const WATCH_DEBOUNCE_FRAMES: u32 = 10;

/// Tile-grid geometry of the bottom dialogue box (8px tiles, 40×30 grid).
pub(crate) const DIALOG_AREA: TileRect = TileRect::new(0, 24, 40, 6);
/// Text lines per dialogue page (`content.th / line_height`, as in draw_dialog).
const DIALOG_LINES_PER_PAGE: usize = 2;
/// Wrap budget for a dialogue line: the box interior width in pixels
/// (Fusion Pixel font: Latin 5px, CJK 10px advance — see
/// `dotzuki_renderer::embedded_font::char_advance`).
const DIALOG_WIDTH_PX: usize = (DIALOG_AREA.tw as usize - 2) * 8;

/// Options for booting a [`RunnerGame`].
#[derive(Debug, Clone, Default)]
pub struct RunnerOptions {
    /// Map to spawn on, overriding the manifest's `game.entryMap`.
    pub map: Option<String>,
    /// UI/script language (`"en"` / `"zh"`); drives `@t` bilingual text.
    pub lang: String,
    /// Watch the project's data/gfx/scene dirs and hot-reload changed
    /// content (windowed mode; the CLI ignores this for headless runs).
    pub watch: bool,
    /// Headless run: never opens an audio device — audio commands resolve
    /// silently (CI/smoke tests).
    pub headless: bool,
    /// PCM pull-render audio (WASM shell): play commands create the audio
    /// engine without an output device, and the host pulls samples via
    /// [`RunnerGame::render_audio`]. Independent of `headless` — cpal is
    /// never touched either way.
    pub pcm_audio: bool,
    /// Ignore an existing save file on boot (`--fresh`).
    pub fresh: bool,
    /// Save file location override (`--save-file`); the default is
    /// `<project>/.dotzuki-save.json`.
    pub save_file: Option<PathBuf>,
    /// Deterministic battle rng: when set, every battle draws from this byte
    /// script (cycling) instead of a seeded PRNG. Test/CI hook.
    pub rng_script: Option<Vec<u8>>,
    /// Write saves at stable points (warp/scene completion). The CLI sets
    /// this for windowed runs; headless runs only with an explicit opt-in
    /// (`--save`), keeping CI side-effect-free. Loading is independent — a
    /// valid save always resumes unless `fresh`/`map` say otherwise.
    pub write_saves: bool,
    /// Delegate all persistence to the embedding host. This disables disk
    /// loading and both automatic and menu-triggered disk writes; the host
    /// uses [`RunnerGame::import_save`] and [`RunnerGame::export_save`].
    pub external_saves: bool,
}

/// Live textbox state: pages waiting on A presses. `engine` is `Some` for a
/// scene-driven text (A on the last page resolves the `showText` promise);
/// `None` for a one-off line (raw NPC `talk` text), which just closes.
struct TextState {
    engine: Option<ScriptEngine>,
    pages: VecDeque<String>,
}

/// Live choice state: the scene is paused on `await game.showChoice([...])`;
/// A resumes it with `signal_done(Number(cursor))`.
struct ChoiceState {
    engine: ScriptEngine,
    options: Vec<String>,
    cursor: usize,
    /// The text page that preceded the choice (redrawn beneath the menu).
    context_text: String,
}

/// Live delay state: the scene resumes after `frames_left` frames.
struct DelayState {
    engine: ScriptEngine,
    frames_left: u16,
}

/// Live battle state: the battle itself plus the scene engine suspended on
/// `await startBattle(...)` — `None` for a sceneless battle (a random
/// encounter armed by walking; nothing to resume). When a scene battle
/// resolves, the engine resumes with `signal_done(Text("win"|"lose"|"run"))`
/// so the scene's own JS branches on the result (the wuxia pattern); a
/// sceneless battle returns straight to the overworld (or the whiteout).
struct BattleState {
    engine: Option<ScriptEngine>,
    battle: Battle,
}

/// Runtime mode — what currently owns input.
enum Mode {
    /// Free overworld movement.
    Overworld,
    /// A textbox is on screen.
    Text(TextState),
    /// A choice menu is on screen.
    Choice(ChoiceState),
    /// A scene-imposed delay is counting down.
    Delay(DelayState),
    /// A battle is running (the scene is suspended). Boxed: the battle is
    /// by far the largest mode payload.
    Battle(Box<BattleState>),
    /// The overworld Start menu (party view / bag / save) is open; the
    /// overworld is frozen underneath.
    Menu(MenuState),
    /// A scene-opened shop (`openShop`) is open; the scene is suspended.
    Shop(Box<ShopState>),
    /// The game-over whiteout after a lost battle: blackout + message, then
    /// the party heals and the player returns to the entry map's spawn.
    Whiteout(WhiteoutState),
    /// Map-less project whose entry scene has finished; nothing to do.
    Idle,
}

/// Fade phase of an overworld warp transition.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FadePhase {
    Out,
    In,
}

/// An in-progress overworld warp: fade out, switch maps, fade in.
struct WarpTransition {
    dest_map: String,
    dest_x: i32,
    dest_y: i32,
    phase: FadePhase,
    frames: u32,
}

impl WarpTransition {
    fn new(dest_map: String, dest_x: i32, dest_y: i32) -> Self {
        Self {
            dest_map,
            dest_x,
            dest_y,
            phase: FadePhase::Out,
            frames: FADE_FRAMES,
        }
    }
}

/// Walkability view the [`OverworldActor`] queries: map collision unioned
/// with the current NPC tiles (the player stops in front of NPCs).
struct CollisionView<'a> {
    map: &'a RuntimeMap,
}

impl CollisionView<'_> {
    /// Any NPC standing on `(x, y)`?
    fn npc_blocks(&self, x: i32, y: i32) -> bool {
        self.map.objects().npcs.iter().any(|n| (n.x, n.y) == (x, y))
    }
}

impl OverworldCollision for CollisionView<'_> {
    fn is_blocked(&self, x: i32, y: i32) -> bool {
        self.map.is_blocked(x, y) || self.npc_blocks(x, y)
    }

    fn is_blocked_at(&self, level: u8, x: i32, y: i32) -> bool {
        // NPCs block their tile at every elevation level (simplest rule: a
        // person is in the way regardless of the player's height).
        self.map.is_blocked_at(level, x, y) || self.npc_blocks(x, y)
    }
}

/// A booted zero-Rust game: overworld + scene VM + dialogue/choice UI.
///
/// Owns the [`LoadedProject`], the current [`RuntimeMap`], the player
/// [`OverworldActor`], the persistent flag store (seeded into / harvested
/// from each short-lived scene engine) and the mode state machine. Drive it
/// with [`update`](Self::update) + [`draw`](Self::draw) — directly (headless)
/// or via the `dotzuki_app::GameLoop` impl (windowed).
pub struct RunnerGame {
    project: LoadedProject,
    /// The current map; `None` in dialogue-only mode (project without maps).
    map: Option<RuntimeMap>,
    camera: Camera,
    actor: OverworldActor,
    /// `gfx/overworld/player/sheet.png` when the project ships one.
    player_sprite: Option<WalkSprite>,
    /// Persistent story flags (cross-scene truth).
    flags: HashMap<String, bool>,
    lang: String,
    mode: Mode,
    /// In-progress overworld warp fade (owns input while active).
    transition: Option<WarpTransition>,
    /// `on_enter` storylines queued to fire one after another.
    pending_scenes: VecDeque<(String, String)>,
    /// A scene-triggered `WarpTo` defers the destination's opening dispatch
    /// until the scene completes (post-warp text must play out first).
    opening_dispatch_pending: bool,
    /// Name of the scene currently being pumped (for diagnostics).
    active_scene: Option<String>,
    /// The text page most recently shown (context under a choice menu).
    last_text: String,
    /// Cosmetic blackout counter for `FadeScreen` commands.
    flash: u32,
    /// Total frames updated (animation pacing / diagnostics).
    frame_count: u64,
    /// File watcher for `--watch` (`None` when watching is off or the
    /// watcher failed to start — the game runs fine either way).
    #[cfg(all(feature = "watch", not(target_arch = "wasm32")))]
    watcher: Option<ProjectWatcher>,
    /// Changed paths accumulated since the last applied reload batch.
    #[cfg(all(feature = "watch", not(target_arch = "wasm32")))]
    watch_pending: HashSet<PathBuf>,
    /// Frames until the next reload batch may apply (burst coalescing).
    #[cfg(all(feature = "watch", not(target_arch = "wasm32")))]
    watch_cooldown: u32,
    /// Music/SFX playback for scene audio commands; silent when the project
    /// ships no `data/audio/` tracks or no output device is available.
    audio: RunnerAudio,
    /// Where the save file lives (`<project>/.dotzuki-save.json` by default).
    save_path: PathBuf,
    /// Whether stable-state saves are written (see [`RunnerOptions::write_saves`]).
    write_saves: bool,
    /// Whether the embedding host owns save persistence.
    external_saves: bool,
    /// Deterministic battle rng byte script (see [`RunnerOptions::rng_script`]).
    rng_script: Option<Vec<u8>>,
    /// The persistent party state (v2-b): every party member's current
    /// HP/MP/status, harvested at the end of each battle (win AND lose) and
    /// restored from a save. `None` until the first battle (or a save
    /// carrying it) — the next battle then starts from the records.
    party_state: Option<Vec<PartyMemberState>>,
    /// The persistent battle inventory (v2-b), same lifecycle as
    /// `party_state`; `None` ⇒ the manifest's `items.starting` counts.
    inventory: Option<HashMap<String, u32>>,
    /// The player's money (v3): initialized from the manifest's
    /// `shop.startMoney` (default 100) on a fresh boot, carried in the save.
    money: u32,
    /// A lost battle arms the game-over whiteout, triggered when the scene
    /// that received `"lose"` finishes into the overworld/idle (its post-lose
    /// text plays first). Cleared when a battle is won instead.
    pending_whiteout: bool,
    /// The weather a scene armed with `setWeather` (v2-e): a `kind: Weather`
    /// RON record id handed to the NEXT battle (battle-local — cleared when
    /// that battle ends, never saved). `clearWeather` resets it to `None`.
    pending_weather: Option<String>,
    /// The overworld's own entropy source for random-encounter rolls,
    /// seeded lazily on the first roll (a scripted stream when
    /// [`RunnerOptions::rng_script`] is set). Separate from the per-battle
    /// rng so step rolls can't perturb battle determinism.
    overworld_rng: Option<Box<dyn BattleRng>>,
    /// Completed walk steps since boot; mixed into the wasm32 rng seed (the
    /// frame counter alone is 0 at boot there).
    steps_taken: u64,
}

include!("game/runtime.rs");

#[cfg(all(feature = "gpu", not(target_arch = "wasm32")))]
impl dotzuki_app::GameLoop for RunnerGame {
    type Fb = FrameBuffer;

    fn update(&mut self, input: &InputState) {
        RunnerGame::update(self, input);
    }

    fn draw(&mut self, frame_buffer: &mut FrameBuffer) {
        RunnerGame::draw(self, frame_buffer);
    }
}

// ── helpers ─────────────────────────────────────────────────────────────────

/// Decode a PNG walk sheet from in-memory bytes (the VFS counterpart of
/// `WalkSprite::load`, which is disk-only).
fn decode_walk_sheet(
    bytes: &[u8],
    path: &str,
    frame_w: u32,
    frame_h: u32,
) -> Result<WalkSprite, String> {
    let img = image::load_from_memory(bytes)
        .map_err(|e| format!("decode {path}: {e}"))?
        .to_rgba8();
    let (w, h) = img.dimensions();
    let pixels = img
        .pixels()
        .map(|p| Rgba::new(p.0[0], p.0[1], p.0[2], p.0[3]))
        .collect();
    WalkSprite::from_rgba(pixels, w, h, frame_w, frame_h)
}

/// Cheap probe for "does this scene export this storyline/function name"
/// without instantiating a [`ScriptEngine`] — matched on the DSL's generated
/// export names (`storyline_<name>`, `<Scene>OnLoad`). [`RunnerGame::activate`]
/// re-validates authoritatively with `has_function` before running.
fn scene_has_fn(project: &LoadedProject, scene: &str, fn_name: &str) -> bool {
    let Some(js) = project.scripts().get_script(scene) else {
        return false;
    };
    js.contains(&format!("storyline_{fn_name}")) || js.contains(&format!("function {fn_name}"))
}

/// Directories `--watch` monitors: every DSL dir, the data root and the
/// gfx root (deduplicated; missing dirs are skipped by the watcher).
#[cfg(all(feature = "watch", not(target_arch = "wasm32")))]
fn watch_dirs(project: &LoadedProject) -> Vec<PathBuf> {
    let mut dirs = project.manifest().dsl_dirs(project.root());
    dirs.push(project.data_root().to_path_buf());
    if let Some(gfx) = project.gfx_root() {
        dirs.push(gfx.to_path_buf());
    }
    let mut seen = HashSet::new();
    dirs.retain(|d| seen.insert(d.clone()));
    dirs
}

/// First free tile scanning outward (Chebyshev rings) from the map centre.
/// "Free" = not map-solid and not NPC-occupied.
fn find_spawn(map: &RuntimeMap) -> (i32, i32) {
    let (cx, cy) = (map.width() as i32 / 2, map.height() as i32 / 2);
    let free = |x: i32, y: i32| {
        !map.is_blocked(x, y) && !map.objects().npcs.iter().any(|n| (n.x, n.y) == (x, y))
    };
    let max_r = (map.width().max(map.height()) as i32) + 1;
    for r in 0..max_r {
        for dy in -r..=r {
            for dx in -r..=r {
                if dx.abs().max(dy.abs()) != r {
                    continue; // ring perimeter only
                }
                let (x, y) = (cx + dx, cy + dy);
                if free(x, y) {
                    return (x, y);
                }
            }
        }
    }
    (cx, cy)
}

/// Held D-pad direction (Up > Down > Left > Right priority, as wuxia).
fn held_direction(input: &InputState) -> Option<Direction> {
    if input.is_held(GbButton::Up) {
        Some(Direction::Up)
    } else if input.is_held(GbButton::Down) {
        Some(Direction::Down)
    } else if input.is_held(GbButton::Left) {
        Some(Direction::Left)
    } else if input.is_held(GbButton::Right) {
        Some(Direction::Right)
    } else {
        None
    }
}

/// Unit step delta for a cardinal direction.
fn direction_delta(dir: Direction) -> (i32, i32) {
    match dir {
        Direction::Down => (0, 1),
        Direction::Up => (0, -1),
        Direction::Left => (-1, 0),
        Direction::Right => (1, 0),
    }
}

/// `"down"`/`"up"`/`"left"`/`"right"` sidecar string → [`Direction`].
fn parse_facing(facing: &str) -> Direction {
    match facing {
        "up" => Direction::Up,
        "left" => Direction::Left,
        "right" => Direction::Right,
        _ => Direction::Down,
    }
}

/// [`Direction`] → the sidecar/save string form (inverse of [`parse_facing`]).
fn facing_name(dir: Direction) -> &'static str {
    match dir {
        Direction::Down => "down",
        Direction::Up => "up",
        Direction::Left => "left",
        Direction::Right => "right",
    }
}

/// Wrap `text` into pages of at most [`DIALOG_LINES_PER_PAGE`] lines each
/// (the join of the page's lines with `\n`). Always at least one page.
fn paginate(text: &str) -> VecDeque<String> {
    let lines = wrap_lines(text, DIALOG_WIDTH_PX, 4096);
    let mut pages: VecDeque<String> = lines
        .chunks(DIALOG_LINES_PER_PAGE)
        .map(|chunk| chunk.join("\n"))
        .collect();
    if pages.is_empty() {
        pages.push_back(String::new());
    }
    pages
}

/// The shared dialogue [`MenuConfig`] (bottom box on the 40×30 tile grid).
fn dialog_config() -> MenuConfig {
    MenuConfig::new(
        DIALOG_AREA,
        None,
        TileRect::new(
            DIALOG_AREA.tx + 1,
            DIALOG_AREA.ty + 1,
            DIALOG_AREA.tw - 2,
            DIALOG_AREA.th - 2,
        ),
        Default::default(),
    )
}

/// Draw the bottom dialogue textbox with one page of text.
pub(crate) fn draw_textbox(fb: &mut FrameBuffer, text: &str) {
    let mut painter = FrameBufferPainter::new(fb);
    draw_dialog(text, &[dialog_config()], &mut painter);
}

/// Centered end card for dialogue-only projects whose entry scene finished:
/// the game name plus a localized "fin." so the screen isn't a void.
fn draw_end_card(fb: &mut FrameBuffer, game_name: &str, lang: &str) {
    let fin = if lang == "zh" { "完" } else { "fin." };
    let cx = SCREEN_W as u32 / 2;
    let name_w = embedded_font::measure_text(game_name);
    embedded_font::draw_text(
        game_name,
        cx.saturating_sub(name_w / 2),
        100,
        Rgba::rgb(0xf0, 0xf0, 0xf0),
        fb,
    );
    let fin_w = embedded_font::measure_text(fin);
    embedded_font::draw_text(
        fin,
        cx.saturating_sub(fin_w / 2),
        120,
        Rgba::rgb(0x90, 0x90, 0xa8),
        fb,
    );
}

/// Draw the choice menu as a flex box just above the dialogue area,
/// right-aligned, sized to the options.
fn draw_choice_menu(fb: &mut FrameBuffer, options: &[String], cursor: usize) {
    let n = options.len() as u32;
    if n == 0 {
        return;
    }
    let max_len = options.iter().map(|o| o.chars().count()).max().unwrap_or(1) as u32;
    // +4: left/right border, cursor column, one padding column.
    let w = (max_len + 4).clamp(8, 20);
    let h = n + 2;
    let tx = (40 - w) as i32;
    let ty = DIALOG_AREA.ty as i32 - h as i32;
    let config = MenuConfig::new(
        TileRect::new(tx.max(0) as u32, ty.max(0) as u32, w, h),
        None,
        TileRect::new(tx.max(0) as u32 + 1, ty.max(0) as u32 + 1, w - 2, n),
        Default::default(),
    );
    let state = FlexMenuState {
        cursor,
        scroll_offset: 0,
    };
    let mut painter = FrameBufferPainter::new(fb);
    let mut ui = Ui::new(&mut painter);
    draw_flex_menu(options, &[config], &state, options.len(), &mut ui);
}

/// Multiply every framebuffer pixel by `factor` (1.0 = unchanged, 0.0 = black).
fn darken(fb: &mut FrameBuffer, factor: f32) {
    for px in fb.data.chunks_exact_mut(4) {
        px[0] = (px[0] as f32 * factor) as u8;
        px[1] = (px[1] as f32 * factor) as u8;
        px[2] = (px[2] as f32 * factor) as u8;
    }
}

// ── placeholder people ──────────────────────────────────────────────────────

/// Palette of a procedurally drawn placeholder person.
struct PersonColors {
    outline: Rgba,
    skin: Rgba,
    body: Rgba,
}

/// The player's palette (red jacket, the classic protagonist read).
const PLAYER_COLORS: PersonColors = PersonColors {
    outline: Rgba::rgb(0x30, 0x18, 0x18),
    skin: Rgba::rgb(0xF0, 0xC8, 0xA0),
    body: Rgba::rgb(0xC8, 0x30, 0x30),
};

/// NPC body colours; the NPC id hashes into this palette.
const NPC_BODIES: [(u8, u8, u8); 6] = [
    (0x30, 0x58, 0xC8), // blue
    (0x38, 0x90, 0x40), // green
    (0x88, 0x48, 0xA8), // purple
    (0xC8, 0x78, 0x28), // orange
    (0x28, 0x98, 0x98), // teal
    (0x80, 0x58, 0x38), // brown
];

/// Per-NPC palette: body colour derived from the id hash.
fn npc_palette(id: u32) -> PersonColors {
    let (r, g, b) = NPC_BODIES[(id.wrapping_mul(2_654_435_761) >> 16) as usize % NPC_BODIES.len()];
    PersonColors {
        outline: Rgba::rgb(r / 3, g / 3, b / 3),
        skin: Rgba::rgb(0xF0, 0xC8, 0xA0),
        body: Rgba::rgb(r, g, b),
    }
}

/// Draw a ~12×14 two-tone placeholder person, centred on and bottom-aligned
/// to the `tile`-px tile whose top-left is `(sx, sy)` in screen pixels. Pure
/// code — no embedded assets. Eyes (or the back of the head when facing up)
/// give a 1-px facing indicator.
fn draw_person(
    fb: &mut FrameBuffer,
    sx: i32,
    sy: i32,
    tile: i32,
    facing: Direction,
    colors: &PersonColors,
) {
    const W: i32 = 12;
    const H: i32 = 14;
    let ox = sx + (tile - W) / 2;
    let oy = sy + tile - H;
    let (w, h) = (fb.width() as i32, fb.height() as i32);
    let mut put = |x: i32, y: i32, c: Rgba| {
        let (px, py) = (ox + x, oy + y);
        if px >= 0 && py >= 0 && px < w && py < h {
            fb.set_pixel(px as u32, py as u32, c);
        }
    };
    let fill = |x: i32, y: i32, fw: i32, fh: i32, c: Rgba, put: &mut dyn FnMut(i32, i32, Rgba)| {
        for dy in 0..fh {
            for dx in 0..fw {
                put(x + dx, y + dy, c);
            }
        }
    };

    // Head (6×5) and torso (8×7), 1-px outline.
    fill(3, 0, 6, 5, colors.outline, &mut put);
    fill(4, 1, 4, 3, colors.skin, &mut put);
    fill(2, 5, 8, 7, colors.outline, &mut put);
    fill(3, 6, 6, 5, colors.body, &mut put);
    // Legs.
    fill(3, 12, 2, 2, colors.outline, &mut put);
    fill(7, 12, 2, 2, colors.outline, &mut put);

    // Facing indicator on the face rows (skin spans x 4..8, y 1..4).
    match facing {
        Direction::Down => {
            put(4, 2, colors.outline);
            put(7, 2, colors.outline);
        }
        Direction::Left => put(4, 2, colors.outline),
        Direction::Right => put(7, 2, colors.outline),
        Direction::Up => fill(4, 1, 4, 3, colors.outline, &mut put), // back of the head
    }
}
