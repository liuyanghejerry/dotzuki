# Game Shell Reference

> - **Audience**: rust developers
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.5.4

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
element, and `requestAnimationFrame`-driven polling.

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
`dotzuki-web = { version = "0.5.4", features = ["game-shell"] }`.

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
    fn draw(&mut self, fb: &mut Self::Fb);
    fn should_exit(&self) -> bool { false }
    fn on_user_gesture(&self) {}
}
```

- `type Fb: FbSurface` — the framebuffer the game draws into: either
  `dotzuki_renderer::FrameBuffer` (true-color games) or
  `dotzuki_renderer::RgbaIndexedFrameBuffer` (fixed-palette games).
- `update(&mut self, input: &InputState)` — called once per GB frame;
  process input before returning.
- `draw(&mut self, fb: &mut Self::Fb)` — called once per redraw; draw the
  current screen into the framebuffer.
- `should_exit(&self) -> bool` — default `false`; the loop exits when it
  returns `true`.
- `on_user_gesture(&self)` — default no-op; called on every key press.
  Browsers count key presses as user gestures, so this is the hook to resume
  a suspended `AudioContext`.

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
  `"NN FPS"` roughly every 30 frames; `None` disables the counter.

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

Both targets pace at one `update` per GB frame (≈16.7427 ms). Per frame the
loop runs: `update` → `input.begin_frame()` → `should_exit` check →
`request_redraw`.

- **Native**: `FRAME_DURATION = 16_742_706 ns`, driven in `AboutToWait` with
  `Instant` deadlines plus `thread::sleep` (game_shell.rs:39, 316-336).
- **wasm32**: `FRAME_MS = 1000.0 * 70224.0 / 4194304.0` measured against
  `performance.now()` with a `next_frame_ms` accumulator and a
  spiral-of-death clamp — when the loop falls behind, the next deadline
  resets to `now + FRAME_MS` instead of bursting catch-up frames
  (game_shell.rs:42, 267-315).

### Rendering

Each `RedrawRequested` runs `draw` into the game's framebuffer, then
`frame_buffer.present_into(pixels.frame_mut())`, then `pixels.render()`.
Render and surface-resize errors are logged and exit the loop
(game_shell.rs:233-248). On wasm the pixels builder forces `Rgba8Unorm` and
the WebGL backend (`Backends::GL`): some browsers expose partial WebGPU
limits that panic wasm-bindgen (game_shell.rs:196-209).

### Input

`KeyCode` events feed `InputState::set_from_keycode`. `Escape` exits on both
targets, with no opt-out. Any key press calls `on_user_gesture` before input
handling (game_shell.rs:249-263).

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

- **`Escape` always exits.** Both targets terminate the loop on Escape; a
  game cannot remap or disable it.
- **Missing placeholder canvas panics (wasm32).** `install_canvas` expects
  an element with `canvas_id` in the host page and panics otherwise — ship
  `<canvas id="game-canvas">` (or your configured id) in the page.
- **`ControlFlow::Poll` is load-bearing.** The loop sets
  `ControlFlow::Poll` + `EventLoop::spawn`; without `Poll`, winit 0.30's
  web backend only ticks when an event arrives (~5 FPS)
  (game_shell.rs:159-160).
- **WebGL is forced on wasm.** The shell pins `Backends::GL` and
  `Rgba8Unorm`; partial WebGPU limit objects in some browsers panic
  wasm-bindgen, so WebGPU is not an option here.
- **Windowing code has no unit tests.** The module is verified through its
  consumers; the example above is a skeleton, not a tested program.
