use anyhow::Result;
use image::{ImageBuffer, Rgba as ImgRgba, RgbaImage};
use dotzuki_engine::camera::{Camera, Rect, Vec2};
use dotzuki_engine::render::MapLayer;
use dotzuki_engine_tiled::{parse_tmx, tmx_to_map_state};
use pixels::{Pixels, SurfaceTexture};
use std::io::Cursor;
use std::time::{Duration, Instant};
use winit::dpi::LogicalSize;
use winit::event::{Event, WindowEvent, ElementState};
use winit::event_loop::{ControlFlow, EventLoop};
use winit::keyboard::{KeyCode, PhysicalKey};
use winit::window::WindowAttributes;
use dotzuki_engine_dsl::bridge::register_dsl_scenes;
use dotzuki_engine_script::loader::ScriptLoader;

const SCREEN_W: u32 = 160;
const SCREEN_H: u32 = 144;
const SCALE: u32 = 3;
const TILE_PX: u32 = 8;
const TILESET_COLS: u32 = 4;
const TILESET_W: u32 = TILESET_COLS * TILE_PX;
const TILESET_H: u32 = TILE_PX;
const PLAYER_TILE_IDX: usize = 2;

fn generate_tileset_png() -> Vec<u8> {
    let mut img: RgbaImage = ImageBuffer::new(TILESET_W, TILESET_H);

    for py in 0..TILE_PX {
        for px in 0..TILE_PX {
            let green = if (px + py) % 4 < 2 { 100 } else { 140 };
            img.put_pixel(px, py, ImgRgba([0, green as u8, 0, 255]));
        }
    }

    let tx = TILE_PX;
    for py in 0..TILE_PX {
        for px in 0..TILE_PX {
            let color = if px == 0 || px == 7 || py == 7 {
                [80, 50, 10, 255]
            } else if px >= 2 && px <= 5 && py <= 6 {
                [120, 80, 20, 255]
            } else if py == 0 {
                [60, 120, 20, 255]
            } else {
                [0, 0, 0, 0]
            };
            img.put_pixel(tx + px, py, ImgRgba(color));
        }
    }

    let px_base = 2 * TILE_PX;
    for py in 0..TILE_PX {
        for px in 0..TILE_PX {
            let color = if py <= 1 && px >= 2 && px <= 5 {
                [220, 30, 30, 255]
            } else if py == 2 && px >= 1 && px <= 6 {
                [255, 200, 150, 255]
            } else if py == 3 && (px == 2 || px == 5) {
                [30, 30, 30, 255]
            } else if py >= 3 && py <= 6 && px >= 2 && px <= 5 {
                [30, 30, 200, 255]
            } else {
                [0, 0, 0, 0]
            };
            img.put_pixel(px_base + px, py, ImgRgba(color));
        }
    }

    let wx = 3 * TILE_PX;
    for py in 0..TILE_PX {
        for px in 0..TILE_PX {
            let blue = if (px + py) % 3 == 0 { 80 } else { 120 };
            img.put_pixel(wx + px, py, ImgRgba([30, 30, blue as u8, 255]));
        }
    }

    let mut png_bytes = Cursor::new(Vec::new());
    img.write_to(&mut png_bytes, image::ImageFormat::Png)
        .expect("failed to encode tileset PNG");
    png_bytes.into_inner()
}

fn load_tileset_bytes() -> Vec<u8> {
    let asset_path = std::path::Path::new("assets/tileset.png");
    if asset_path.exists() {
        std::fs::read(asset_path).unwrap_or_else(|_| generate_tileset_png())
    } else {
        generate_tileset_png()
    }
}

fn extract_tile(pixels: &[u8], tileset_w: u32, tile_idx: usize, x: u32, y: u32) -> [u8; 4] {
    let tile_col = (tile_idx as u32 % (tileset_w / TILE_PX)) * TILE_PX;
    let tile_row = (tile_idx as u32 / (tileset_w / TILE_PX)) * TILE_PX;
    let px = (tile_col + x) as usize;
    let py = (tile_row + y) as usize;
    let idx = (py * tileset_w as usize + px) * 4;
    [pixels[idx], pixels[idx + 1], pixels[idx + 2], pixels[idx + 3]]
}

fn tiled_gid_to_tileset_idx(gid: u16) -> Option<usize> {
    match gid {
        0 => None,
        1 => Some(0),
        2 => Some(1),
        4 => Some(3),
        _ => None,
    }
}

fn main() -> Result<()> {
    env_logger::init();
    let event_loop = EventLoop::new()?;

    let window_attrs = WindowAttributes::default()
        .with_title("JRPG Demo")
        .with_inner_size(LogicalSize::new((SCREEN_W * SCALE) as f64, (SCREEN_H * SCALE) as f64))
        .with_min_inner_size(LogicalSize::new(SCREEN_W as f64, SCREEN_H as f64))
        .with_resizable(true);

    #[allow(deprecated)]
    let window = event_loop.create_window(window_attrs)?;

    let mut pixels = {
        let window_size = window.inner_size();
        let surface_texture = SurfaceTexture::new(window_size.width, window_size.height, &window);
        Pixels::new(SCREEN_W, SCREEN_H, surface_texture)?
    };

    let png_bytes = load_tileset_bytes();
    let dyn_img = image::load_from_memory(&png_bytes)?;
    let rgba = dyn_img.to_rgba8();
    let tileset_pixels = rgba.into_raw();
    let tileset_width = dyn_img.width();

    let tmx_json = include_str!("../assets/demo.tmx");
    let tmx = parse_tmx(tmx_json)?;
    let render_state = tmx_to_map_state(&tmx);
    let map_w_tiles = tmx.width as u16;
    let map_h_tiles = tmx.height as u16;
    let map_pixels_w = map_w_tiles as f32 * TILE_PX as f32;
    let map_pixels_h = map_h_tiles as f32 * TILE_PX as f32;

    let mut camera = Camera::new(SCREEN_W as f32, SCREEN_H as f32);
    camera.smooth_factor = 0.15;
    camera.clamp_to_bounds(Rect::new(-8.0, -8.0, map_pixels_w + 8.0, map_pixels_h + 8.0));

    let mut player_x = map_pixels_w / 2.0;
    let mut player_y = map_pixels_h / 2.0;

    let mut held_up = false;
    let mut held_down = false;
    let mut held_left = false;
    let mut held_right = false;

    // ── DSL scene engine ──────────────────────────────────────────
    let mut dsl_loader = ScriptLoader::new();
    register_dsl_scenes(&mut dsl_loader);
    let mut script_engine = dotzuki_engine_script::ScriptEngine::new();

    let mut last_frame = Instant::now();
    let move_delay = Duration::from_millis(120);
    let mut since_last_move = Duration::ZERO;

    #[allow(deprecated)]
    event_loop.run(move |event, elwt| {
        elwt.set_control_flow(ControlFlow::Poll);

        match event {
            Event::WindowEvent { event: WindowEvent::CloseRequested, .. } => {
                elwt.exit();
            }
            Event::WindowEvent { event: WindowEvent::KeyboardInput { event: key_event, .. }, .. } => {
                if let PhysicalKey::Code(code) = key_event.physical_key {
                    let pressed = key_event.state == ElementState::Pressed;
                    match code {
                        KeyCode::ArrowUp => held_up = pressed,
                        KeyCode::ArrowDown => held_down = pressed,
                        KeyCode::ArrowLeft => held_left = pressed,
                        KeyCode::ArrowRight => held_right = pressed,
                        KeyCode::Escape if pressed => elwt.exit(),
                        KeyCode::Space if pressed => {
                            if let Some(js) = dsl_loader.get_script("DialogDemo") {
                                let _ = script_engine.load_script(js);
                                let _ = script_engine.call_function_no_args("storyline_main");
                            }
                        }
                        _ => {}
                    }
                }
            }
            Event::WindowEvent { event: WindowEvent::Resized(size), .. } => {
                let _ = pixels.resize_surface(size.width, size.height);
            }
            Event::AboutToWait => {
                let now = Instant::now();
                let dt = now.duration_since(last_frame);
                last_frame = now;
                since_last_move += dt;

                let step = TILE_PX as f32;
                if since_last_move >= move_delay {
                    if held_up { player_y = (player_y - step).max(8.0); }
                    if held_down { player_y = (player_y + step).min(map_pixels_h - 8.0); }
                    if held_left { player_x = (player_x - step).max(8.0); }
                    if held_right { player_x = (player_x + step).min(map_pixels_w - 8.0); }
                    since_last_move = Duration::ZERO;
                }

                camera.follow_target(Vec2::new(
                    player_x - SCREEN_W as f32 / 2.0,
                    player_y - SCREEN_H as f32 / 2.0,
                ));
                camera.update(dt.as_secs_f32());

                let frame = pixels.frame_mut();
                frame.fill(0);

                let mut sorted_layers: Vec<&MapLayer> = render_state.layers.iter()
                    .filter(|l| l.visible).collect();
                sorted_layers.sort_by_key(|l| l.z_index);

                let cam_x = camera.position.x as i32;
                let cam_y = camera.position.y as i32;

                for layer in &sorted_layers {
                    let scroll_x = (cam_x as f32 * layer.scroll_factor.0) as i32;
                    let scroll_y = (cam_y as f32 * layer.scroll_factor.1) as i32;

                    let start_tile_x = scroll_x / TILE_PX as i32;
                    let start_tile_y = scroll_y / TILE_PX as i32;
                    let end_tile_x = (scroll_x + SCREEN_W as i32 + TILE_PX as i32 - 1) / TILE_PX as i32;
                    let end_tile_y = (scroll_y + SCREEN_H as i32 + TILE_PX as i32 - 1) / TILE_PX as i32;

                    for ty in start_tile_y..=end_tile_y {
                        for tx in start_tile_x..=end_tile_x {
                            if tx < 0 || ty < 0
                                || tx >= layer.tilemap.width as i32
                                || ty >= layer.tilemap.height as i32
                            {
                                continue;
                            }
                            let entry = &layer.tilemap.entries
                                [(ty as usize) * layer.tilemap.width as usize + (tx as usize)];
                            if entry.tile_id == 0 {
                                continue;
                            }
                            let Some(ts_idx) = tiled_gid_to_tileset_idx(entry.tile_id) else {
                                continue;
                            };
                            let screen_x = tx * TILE_PX as i32 - scroll_x;
                            let screen_y = ty * TILE_PX as i32 - scroll_y;

                            for py in 0..TILE_PX as i32 {
                                for px in 0..TILE_PX as i32 {
                                    let sx = screen_x + px;
                                    let sy = screen_y + py;
                                    if sx < 0 || sy < 0 || sx >= SCREEN_W as i32 || sy >= SCREEN_H as i32 {
                                        continue;
                                    }
                                    let color = extract_tile(
                                        &tileset_pixels, tileset_width, ts_idx, px as u32, py as u32,
                                    );
                                    if color[3] > 0 {
                                        let fidx = (sy as u32 * SCREEN_W + sx as u32) as usize * 4;
                                        if fidx + 3 < frame.len() {
                                            let a = color[3] as f32 / 255.0;
                                            let inv_a = 1.0 - a;
                                            frame[fidx] = (color[0] as f32 * a + frame[fidx] as f32 * inv_a) as u8;
                                            frame[fidx + 1] = (color[1] as f32 * a + frame[fidx + 1] as f32 * inv_a) as u8;
                                            frame[fidx + 2] = (color[2] as f32 * a + frame[fidx + 2] as f32 * inv_a) as u8;
                                            frame[fidx + 3] = 255;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                let player_sx = (player_x - cam_x as f32) as i32;
                let player_sy = (player_y - cam_y as f32) as i32;

                for py in 0..TILE_PX as i32 {
                    for px in 0..TILE_PX as i32 {
                        let sx = player_sx + px;
                        let sy = player_sy + py;
                        if sx < 0 || sy < 0 || sx >= SCREEN_W as i32 || sy >= SCREEN_H as i32 {
                            continue;
                        }
                        let color = extract_tile(
                            &tileset_pixels, tileset_width, PLAYER_TILE_IDX, px as u32, py as u32,
                        );
                        if color[3] > 0 {
                            let fidx = (sy as u32 * SCREEN_W + sx as u32) as usize * 4;
                            if fidx + 3 < frame.len() {
                                frame[fidx] = color[0];
                                frame[fidx + 1] = color[1];
                                frame[fidx + 2] = color[2];
                                frame[fidx + 3] = 255;
                            }
                        }
                    }
                }

                if let Err(e) = pixels.render() {
                    log::error!("render error: {e}");
                }
            }
            _ => {}
        }
    })?;

    Ok(())
}
