use std::sync::Arc;
use std::time::{Duration, Instant};

use error_iter::ErrorIter as _;
use log::error;
use pixels::{PixelsBuilder, SurfaceTexture};
use winit::dpi::LogicalSize;
use winit::event::{ElementState, Event, WindowEvent};
use winit::event_loop::EventLoop;
use winit::keyboard::{KeyCode, PhysicalKey};
use winit::window::Window;

use crate::input::InputState;
use crate::FbSurface;

/// Original Game Boy VBlank frequency: 4194304 Hz / 70224 cycles ≈ 59.7275 Hz
const FRAME_DURATION: Duration = Duration::from_nanos(16_742_706); // 1e9 / 59.7275

pub struct GameWindowConfig {
    pub title: String,
    pub scale: u32,
    pub resizable: bool,
    /// Logical framebuffer width in pixels.
    /// Set to 240 for GBA-resolution games (e.g. the FireRed example).
    pub width: u32,
    /// Logical framebuffer height in pixels.
    /// Set to 160 for GBA-resolution games.
    pub height: u32,
}

pub trait GameLoop {
    /// The framebuffer type the game draws into: either the engine's RGBA
    /// [`FrameBuffer`] (true-color games) or the indexed
    /// [`crate::RgbaIndexedFrameBuffer`] (fixed-palette games).
    type Fb: FbSurface;

    fn update(&mut self, input: &InputState);

    /// Primary click in framebuffer pixels. Default preserves button-only games.
    fn pointer_click(&mut self, _x: f32, _y: f32) {}

    /// Focus loss or canceled touch; discard pending pointer-driven actions.
    fn cancel_pointer_input(&mut self) {}
    fn draw(&mut self, frame_buffer: &mut Self::Fb);
    fn should_exit(&self) -> bool {
        false
    }
}

#[derive(Debug, thiserror::Error)]
pub enum WindowError {
    #[error("Failed to create event loop: {0}")]
    EventLoop(String),
    #[error("Failed to create window: {0}")]
    WindowCreation(String),
    #[error("Failed to create pixel buffer: {0}")]
    PixelBuffer(#[from] pixels::Error),
}

pub fn run<G: GameLoop + 'static>(
    config: GameWindowConfig,
    mut game: G,
) -> Result<(), WindowError> {
    let event_loop = EventLoop::new().map_err(|e| WindowError::EventLoop(e.to_string()))?;
    let (fb_width, fb_height) = (config.width, config.height);
    let window = {
        let size = LogicalSize::new(
            (fb_width * config.scale) as f64,
            (fb_height * config.scale) as f64,
        );
        #[allow(deprecated)]
        Arc::new(
            event_loop
                .create_window(
                    Window::default_attributes()
                        .with_title(&config.title)
                        .with_inner_size(size)
                        .with_min_inner_size(LogicalSize::new(fb_width as f64, fb_height as f64))
                        .with_resizable(config.resizable),
                )
                .map_err(|e| WindowError::WindowCreation(e.to_string()))?,
        )
    };

    let mut pixels = {
        let window_size = window.inner_size();
        let surface_texture =
            SurfaceTexture::new(window_size.width, window_size.height, Arc::clone(&window));
        PixelsBuilder::new(fb_width, fb_height, surface_texture).build()?
    };

    let mut frame_buffer = G::Fb::new_screen(fb_width, fb_height);
    let mut input = InputState::new();
    let mut cursor = None;
    let mut click_start: Option<(f64, f64)> = None;
    let mut touch_id = None;
    let mut active_touches = std::collections::BTreeSet::new();
    let mut next_frame_time = Instant::now();

    #[allow(deprecated)]
    let res = event_loop.run(move |event, elwt| match event {
        Event::WindowEvent { event, .. } => match event {
            WindowEvent::CloseRequested => {
                elwt.exit();
            }
            WindowEvent::Focused(false) => {
                input.clear();
                cursor = None;
                click_start = None;
                touch_id = None;
                active_touches.clear();
                game.cancel_pointer_input();
            }
            WindowEvent::RedrawRequested => {
                game.draw(&mut frame_buffer);
                frame_buffer.present_into(pixels.frame_mut());
                if let Err(err) = pixels.render() {
                    log_error("pixels.render", err);
                    elwt.exit();
                }
            }
            WindowEvent::Resized(size) => {
                if size.width > 0 && size.height > 0 {
                    if let Err(err) = pixels.resize_surface(size.width, size.height) {
                        log_error("pixels.resize_surface", err);
                        elwt.exit();
                    }
                }
            }
            WindowEvent::CursorLeft { .. } => {
                cursor = None;
                click_start = None;
            }
            WindowEvent::CursorMoved { position, .. } => {
                cursor = Some((position.x, position.y));
                if click_start.is_some_and(|(x, y)| {
                    (x - position.x).abs() > 8.0 || (y - position.y).abs() > 8.0
                }) {
                    click_start = None;
                }
            }
            WindowEvent::MouseInput {
                state,
                button: winit::event::MouseButton::Left,
                ..
            } => {
                if state == ElementState::Pressed {
                    click_start = cursor;
                } else if click_start.take().is_some() {
                    if let Some(point) = cursor {
                        if let Ok((x, y)) =
                            pixels.window_pos_to_pixel((point.0 as f32, point.1 as f32))
                        {
                            game.pointer_click(x as f32, y as f32);
                        }
                    }
                }
            }
            WindowEvent::Touch(touch) => {
                use winit::event::TouchPhase;
                let point = (touch.location.x, touch.location.y);
                match touch.phase {
                    TouchPhase::Started if active_touches.is_empty() => {
                        active_touches.insert(touch.id);
                        touch_id = Some(touch.id);
                        click_start = Some(point);
                    }
                    TouchPhase::Started => {
                        active_touches.insert(touch.id);
                        click_start = None;
                    }
                    TouchPhase::Moved if touch_id == Some(touch.id) => {
                        if click_start.is_some_and(|(x, y)| {
                            (x - point.0).abs() > 8.0 || (y - point.1).abs() > 8.0
                        }) {
                            click_start = None;
                        }
                    }
                    TouchPhase::Ended if touch_id == Some(touch.id) => {
                        active_touches.remove(&touch.id);
                        touch_id = None;
                        if click_start.take().is_some_and(|(x, y)| {
                            (x - point.0).abs() <= 8.0 && (y - point.1).abs() <= 8.0
                        }) {
                            if let Ok((x, y)) =
                                pixels.window_pos_to_pixel((point.0 as f32, point.1 as f32))
                            {
                                game.pointer_click(x as f32, y as f32);
                            }
                        }
                    }
                    TouchPhase::Ended => {
                        active_touches.remove(&touch.id);
                    }
                    TouchPhase::Cancelled => {
                        active_touches.clear();
                        touch_id = None;
                        click_start = None;
                        game.cancel_pointer_input();
                    }
                    _ => {}
                }
            }
            WindowEvent::KeyboardInput {
                event: key_event, ..
            } => {
                if let PhysicalKey::Code(keycode) = key_event.physical_key {
                    let pressed = key_event.state == ElementState::Pressed;
                    if pressed && keycode == KeyCode::Escape {
                        elwt.exit();
                        return;
                    }
                    input.set_from_keycode(keycode, pressed);
                }
            }
            _ => {}
        },
        Event::AboutToWait => {
            let now = Instant::now();
            if now >= next_frame_time {
                game.update(&input);
                input.begin_frame();
                if game.should_exit() {
                    elwt.exit();
                    return;
                }
                window.request_redraw();
                next_frame_time += FRAME_DURATION;
                if next_frame_time < now {
                    next_frame_time = now + FRAME_DURATION;
                }
            }
            let sleep_duration = next_frame_time.saturating_duration_since(Instant::now());
            if !sleep_duration.is_zero() {
                std::thread::sleep(sleep_duration);
            }
        }
        _ => {}
    });

    res.map_err(|e| WindowError::EventLoop(e.to_string()))
}

fn log_error<E: core::error::Error + 'static>(method_name: &str, err: E) {
    error!("{method_name}() failed: {err}");
    for source in err.sources().skip(1) {
        error!("  Caused by: {source}");
    }
}
