# Game Shell Reference

> - **Audience**: rust developers
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.11.0 (unreleased changes)

The [game shell](./glossary.md) (`dotzuki_web::game_shell`, source
`crates/dotzuki-web/src/game_shell.rs`) runs a `GameLoop` game in a browser
canvas (wasm32) or a native fallback window at Game Boy frame pacing. This
page is the API reference for its feature gate, `GameLoop` trait,
`GameShellConfig`, and `run_game`.

## What it is

The game shell is the web counterpart to the native-only
`dotzuki_renderer::window::run`: the same pixels + winit stack and the same
GB-frame pacing (4194304 Hz / 70224 cycles ≈ 59.7275 Hz), plus the browser
plumbing a wasm game needs — replacing a placeholder `<canvas>` in the host
page, tracking the parent's width on window resize, an optional FPS-counter
element, and `requestAnimationFrame`-driven presentation.

Game-specific wiring stays in the game crate: it builds a
`GameShellConfig`, implements `GameLoop`, and — when the host page needs
runtime control over the live game — keeps its own clone of the
`Rc<RefCell<G>>` it passes to `run_game`.

The shell's `GameLoop` is a separate trait from the native one, kept
separate so `dotzuki-web` stays wasm-compatible:

| | `dotzuki_renderer::window::GameLoop` | `dotzuki_web::game_shell::GameLoop` |
|---|---|---|
| Targets | native only | wasm32 + native fallback |
| Entry point | `run(config, game)` — sync, game by value | `run_game(config, Rc<RefCell<G>>)` — async |
| Config type | `GameWindowConfig` | `GameShellConfig` (adds `canvas_id`, `fps_element_id`) |
| Gesture hook | — | `on_user_gesture` |
| Also exported as | `dotzuki_app::GameLoop` / `dotzuki_app::run` | `dotzuki_web` crate root |

The in-repo consumer pattern to copy is the *native* path: `dotzuki-runner`
implements `dotzuki_app::GameLoop` for `RunnerGame`
(`crates/dotzuki-runner/src/game.rs`) and `dotzuki-cli` boots it with
`dotzuki_app::run(...)` — that is the `dotzuki_renderer::window` path
re-exported through `dotzuki-app`, not this game shell. The editor's
[WASM runner](./glossary.md) builds enable only the `modern-audio` feature,
so `game-shell` has no in-repo consumer yet; it is game-facing API.

## Feature gate

The module is gated behind the `game-shell` Cargo feature of `dotzuki-web`
(`crates/dotzuki-web/Cargo.toml:45-63`), **off by default** so the editor
layout-preview bridge does not drag pixels / winit into consumers that never
open a window. Enable it in `Cargo.toml` with
`dotzuki-web = { version = "0.10.1", features = ["game-shell"] }`.

The feature pulls in `pixels =0.15.0`, `winit 0.30`, `error-iter`,
`dotzuki-renderer/gpu` (for `InputState::set_from_keycode`), and the
`web-sys` DOM types (`Window`, `Document`, `Element`, `Node`, `Event`,
`EventTarget`, `Performance`, `HtmlCanvasElement`, `GpuTextureFormat`).
With the feature on, the crate root re-exports the flat API: `GameLoop`,
`GameShellConfig`, `GameShellError`, `run_game`
(`crates/dotzuki-web/src/lib.rs:25`).

## `GameLoop` trait

Quoted from `game_shell.rs:47-67`:

```rust
pub trait GameLoop {
    type Fb: FbSurface;

    fn update(&mut self, input: &InputState);
    fn pointer_click(&mut self, _x: f32, _y: f32) {}
    fn cancel_pointer_input(&mut self) {}
    fn draw(&mut self, fb: &mut Self::Fb);
    fn should_exit(&self) -> bool { false }
    fn on_user_gesture(&self) {}
}
```

- `type Fb: FbSurface` — the framebuffer the game draws into:
  `dotzuki_renderer::FrameBuffer` (true-color games),
  `dotzuki_renderer::RgbaIndexedFrameBuffer` (packed fixed-palette storage), or
  `dotzuki_renderer::LinearRgbaIndexedFrameBuffer` (word-aligned byte indices).
  These storage choices have the same meaning on every target; the application
  selects the format. All three implement `FbSurface`.
- `update(&mut self, input: &InputState)` — called once per GB frame;
  process input before returning.
- `draw(&mut self, fb: &mut Self::Fb)` — called once per redraw; draw the
  current screen into the framebuffer.
- `should_exit(&self) -> bool` — default `false`; the loop exits when it
  returns `true`.
- `pointer_click` receives framebuffer coordinates for a primary click or tap.
  `cancel_pointer_input` discards pending actions on focus loss or touch cancellation.
  Both default to no-op; games decide whether to enable pointer navigation.
- `on_user_gesture(&self)` — default no-op; called on key, mouse, or touch presses.
  Use this hook to resume a suspended `AudioContext`.

## `GameShellConfig`

Quoted from `game_shell.rs:70-89`:

```rust
pub struct GameShellConfig {
    pub title: String,
    pub scale: u32,
    pub resizable: bool,
    pub width: u32,
    pub height: u32,
    pub canvas_id: String,              // wasm only
    pub fps_element_id: Option<String>, // wasm only
}
```

- `width` / `height` — logical framebuffer pixels (e.g. 160×144 for
  GB-resolution games, 240×160 for GBA-resolution games).
- `scale` — integer factor for the initial window size; the window's minimum
  inner size is the unscaled framebuffer size.
- `canvas_id` (wasm only) — DOM id of the placeholder `<canvas>` the shell
  replaces.
- `fps_element_id` (wasm only) — DOM id of an element updated with
  `"NN FPS"` every 30 completed renders; `None` disables the counter.

`GameShellConfig::new(title, width, height, scale)` fills the conventional
defaults: `resizable: true`, `canvas_id: "game-canvas"`,
`fps_element_id: Some("fps-counter")` — both DOM ids are no-ops when the
host page lacks the elements.

## `run_game`

Quoted from `game_shell.rs:154-157`:

```rust
pub async fn run_game<G: GameLoop + 'static>(
    config: GameShellConfig,
    game: Rc<RefCell<G>>,
) -> Result<(), GameShellError>
```

- **Native**: runs the winit event loop to completion and returns when the
  game exits.
- **wasm32**: hands the game to the browser event loop
  (`EventLoop::spawn`) and returns immediately.
- The function is async because pixels' surface creation is async on wasm;
  native callers wrap it in `pollster::block_on`.
- The game lives behind an `Rc<RefCell<G>>` so the host page can keep a
  clone and drive the live game between frames through its own exported
  functions — sound because JS is single-threaded and those calls never
  land inside `update` / `draw`.

### `GameShellError`

Quoted from `game_shell.rs:110-117`:

```rust
pub enum GameShellError {
    EventLoop(String),
    WindowCreation(String),
    PixelBuffer(pixels::Error),
}
```

Implements `Debug` / `Display` / `Error`; only `PixelBuffer` carries a
`source()`, and `From<pixels::Error>` converts into it.

## Runtime behavior

### Pacing

Simulation advances at ≈59.7275 updates per second, independently of display refresh.
Each update consumes one `BufferedInput::next_frame()` snapshot and checks `should_exit`.

- **Native**: `AboutToWait` uses `Instant` deadlines and `ControlFlow::WaitUntil`.
  Waiting does not block queued input or redraw events.
- **wasm32**: `ControlFlow::Wait` yields between browser paints. `AboutToWait` requests
  the next redraw; `RedrawRequested` samples `performance.now()` and advances the fixed clock.
  A short delay catches up at most five ticks. A longer pause discards the backlog and
  resumes with one tick, so a suspended tab does not replay seconds of held input.
  Paints with no due tick skip simulation and rendering.

### Rendering

After due updates, the shell calls `draw`, `frame_buffer.present_into(pixels.frame_mut())`,
and `pixels.render()`. Games must not advance gameplay in `draw`: a slow display can present
several simulation ticks together. The optional FPS element counts completed renders, not ticks.
Render and surface-resize errors are logged and exit the loop. On wasm the pixels builder forces
`Rgba8Unorm` and WebGL (`Backends::GL`) because some browsers expose partial WebGPU limits.

### Retained frames in the zero-Rust runner

The native player, editor Play and mobile runner retain their RGBA framebuffer
between ticks. `RunnerGame::draw_retained` updates this buffer and returns a
`DirtyRegion` in screen pixels. The first frame covers the full viewport.
A stationary overworld, dialogue page, choice or root pause menu returns an
empty region. With a fixed camera, walking, turning, changing the destination
marker or moving the menu cursor redraws the affected bounds. This includes
NPCs and higher map layers that intersect those bounds.

Camera movement, elevation changes, a map reload, fades and battles redraw the
viewport. Inventory, party and shop screens also use the full draw path. A
host that replaces or edits the output buffer calls `RunnerGame::draw` for a
complete frame. The web `tick` and mobile RGBA copy interfaces still deliver
a complete image to their callers.

### Indexed dialogue text

`dotzuki_renderer::embedded_font::draw_text` and `draw_text_scaled` resolve
the ink color against the framebuffer's base palette once per string. Both
packed and linear indexed surfaces write those indices through the full Fusion
Pixel font, including Latin, CJK and the two cursor arrows (▶ and ▼). A palette
fade or remap therefore applies to newly drawn dialogue in the same way it
applies to text already on screen.

### Four-colour battle transition snapshots

`dotzuki_renderer::battle_transition::CompactTransitionSnapshot::capture`
captures a `LinearRgbaIndexedFrameBuffer<GbColor>`. It stores four pixel
indices per byte and the current display palette. A 160 × 144 image occupies
5,760 bytes of pixel storage. `render` applies a `BattleTransitionState`
to a linear destination with its active palette. `restore` also restores the
captured palette. Both methods accept different source and destination
dimensions and clip to their common area when restoring source pixels.

### Input

Keyboard events feed `BufferedInput`; a press and release between ticks survives for one update.
Focus loss discards held buttons and pending taps. `Escape` exits native windows; browsers leave
it unmapped and continue running. Q/E map to L/R; arrows, WASD, Z/X, Enter/Space, and
Backspace/Right Shift retain their existing mappings.

`GbButton::bit_mask`, `InputState::raw_current`, `raw_previous`, `pressed_mask`, and
`set_from_bitmask` use `u16`. Bits 0–7 remain A, B, Select, Start, Right, Left, Up, Down;
bits 8–9 are R and L. `from_explicit_channels(current, previous, pressed)` supplies an
independent press-edge channel without changing held state. `begin_frame` or physical
input mutations restore the usual `current & !previous` derivation. The runner's existing
8-bit Web/mobile entry points zero-extend their input and keep their ABI.

### Canvas plumbing (wasm32)

`install_canvas` sets the winit canvas id and **replaces** the host page's
placeholder element that has `config.canvas_id`; it panics with
`couldn't find placeholder canvas element` when the element is missing
(game_shell.rs:382-397). A window-resize listener re-fits the surface to the
parent's width, clamped to the viewport and to the scale-multiple
framebuffer width, preserving the framebuffer aspect ratio
(game_shell.rs:362-377, 399-418).

## Example

A minimal game: a white 8×8 block moving right across a 160×144 screen while
`Right` is held. Native entry point shown; on wasm32 call `run_game` without
`pollster::block_on`, and keep a clone of the `Rc<RefCell<TinyGame>>` when
the host page needs to drive the game.

<!-- not verified -->
```rust
use std::cell::RefCell;
use std::rc::Rc;

use dotzuki_renderer::input::{GbButton, InputState};
use dotzuki_renderer::{FbSurface, FrameBuffer, Rgba};
use dotzuki_web::game_shell::{run_game, GameLoop, GameShellConfig, GameShellError};

struct TinyGame {
    block_x: u32,
}

impl GameLoop for TinyGame {
    type Fb = FrameBuffer;

    fn update(&mut self, input: &InputState) {
        if input.is_held(GbButton::Right) {
            self.block_x = (self.block_x + 1) % 160;
        }
    }

    fn draw(&mut self, fb: &mut Self::Fb) {
        fb.fill_rect(0, 0, 160, 144, Rgba::BLACK);
        fb.fill_rect(self.block_x, 64, 8, 8, Rgba::WHITE);
    }
}

fn main() -> Result<(), GameShellError> {
    let config = GameShellConfig::new("Tiny Game", 160, 144, 4);
    let game = Rc::new(RefCell::new(TinyGame { block_x: 0 }));
    pollster::block_on(run_game(config, game))
}
```

## Gotchas

- **`Escape` exits native windows.** In browsers it remains unmapped, so it cannot stop
  the loop and leave the last canvas frame frozen.
- **Missing placeholder canvas panics (wasm32).** `install_canvas` expects
  an element with `canvas_id` in the host page and panics otherwise — ship
  `<canvas id="game-canvas">` (or your configured id) in the page.
- **Keep redraw requests active.** Browser pacing relies on the next redraw requested from
  `AboutToWait`, with `ControlFlow::Wait` between paints.
- **WebGL is forced on wasm.** The shell pins `Backends::GL` and
  `Rgba8Unorm`; partial WebGPU limit objects in some browsers panic
  wasm-bindgen, so WebGPU is not an option here.
- **Test both clock and host integration.** Unit tests cover 30–240 Hz displays, delayed
  paints, suspended tabs, buffered taps, and button channels. Consumers still need native
  and browser smoke tests; the example above remains an unverified skeleton.
