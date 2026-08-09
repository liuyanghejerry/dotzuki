//! Faithful FireRed overworld renderer for Pallet Town.
//!
//! Reproduces `pokefirered`'s metatile compositing pipeline on the jrpg-engine
//! framebuffer. Each 16×16 metatile is two 2×2-tile layers; the player sprite
//! composites *between* them so it walks behind tree canopies and roof tops
//! (the `DrawMetatile` bottom/middle/top BG split, collapsed into three
//! framebuffer passes — see [`LayerType`]).

use std::time::Instant;

use firered_data::{
    FireRedMap, LayerType, TileEntry, GBA_SCREEN_HEIGHT, GBA_SCREEN_WIDTH, METATILE,
    PLAYER_FRAME_H, PLAYER_FRAME_W,
};
use jrpg_engine::camera::{Camera, Vec2};
use jrpg_engine::overworld::actor::{OverworldActor, OverworldCollision};
use jrpg_engine::overworld::types::Direction;
use jrpg_engine::render::{FrameBuffer, Rgba};
use jrpg_renderer::input::{GbButton, InputState};
use jrpg_renderer::window::GameLoop;

const SCREEN_W: i32 = GBA_SCREEN_WIDTH as i32;
const SCREEN_H: i32 = GBA_SCREEN_HEIGHT as i32;
const MT: i32 = METATILE as i32; // 16
const TILE_I: i32 = 8;
const HALF_W: f32 = GBA_SCREEN_WIDTH as f32 / 2.0;
const HALF_H: f32 = GBA_SCREEN_HEIGHT as f32 / 2.0;

/// `(idle_frame, walk_frame_a, walk_frame_b, hflip)` in the red_normal sheet for a
/// facing. Standard object-event layout: 0=south,1=north,2=west still; 3/4 south
/// walk, 5/6 north walk, 7/8 west walk. East reuses the west frames mirrored.
fn facing_frames(d: Direction) -> (usize, usize, usize, bool) {
    match d {
        Direction::Down => (0, 3, 4, false),
        Direction::Up => (1, 5, 6, false),
        Direction::Left => (2, 7, 8, false),
        Direction::Right => (2, 7, 8, true),
    }
}

/// Walkability view over the FireRed map for the generic [`OverworldActor`] (orphan
/// rules: the foreign `OverworldCollision` is implemented on this local newtype).
struct Collide<'a>(&'a FireRedMap);
impl OverworldCollision for Collide<'_> {
    fn is_blocked(&self, x: i32, y: i32) -> bool {
        self.0.is_blocked(x, y)
    }
}

pub struct FireRedGame {
    map: FireRedMap,
    camera: Camera,
    /// The player as a generic overworld actor (movement/facing/walk-state) — the
    /// shared engine layer. FireRed supplies only a collision view and its own
    /// GB-tile player draw (a *different* render backend than wuxia's WalkSprite,
    /// which is exactly what proves the actor is render-agnostic).
    actor: OverworldActor,
    last_frame: Instant,
    show_debug: bool,
    /// When false, skip pass 3 (top layers over the player) — debug aid for
    /// verifying the walk-behind compositing.
    pub overlay_top: bool,
}

impl FireRedGame {
    pub fn new() -> Self {
        let map = FireRedMap::load();

        // Spawn on a walkable tile near the centre of town (in front of the houses).
        let actor = OverworldActor::new(10, 9, MT);

        let mut camera = Camera::new(GBA_SCREEN_WIDTH as f32, GBA_SCREEN_HEIGHT as f32);
        camera.smooth_factor = 0.0; // locked to the player, like the GBA camera

        let mut game = Self {
            map,
            camera,
            actor,
            last_frame: Instant::now(),
            show_debug: false,
            overlay_top: true,
        };
        game.center_camera();
        game.camera.update(0.0);
        game
    }

    /// Place the player on a metatile (debug/testing helper).
    pub fn teleport(&mut self, tx: i32, ty: i32) {
        let facing = self.actor.facing();
        self.actor.place(tx, ty, facing);
        self.center_camera();
        self.camera.update(0.0);
    }

    fn center_camera(&mut self) {
        // Centre the player's foot-tile centre on the screen.
        let cx = self.actor.px() + (MT / 2) as f32;
        let cy = self.actor.py() + (MT / 2) as f32;
        self.camera
            .follow_target(Vec2::new(cx - HALF_W, cy - HALF_H));
    }

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

    /// The player sprite frame to show this instant: `(frame, hflip)`. The actor's
    /// generic walk index (0 = neutral, 1/2 = the two step frames) maps onto this
    /// facing's FireRed tile set.
    fn player_frame(&self) -> (usize, bool) {
        let (idle, walk_a, walk_b, hflip) = facing_frames(self.actor.facing());
        let frame = match self.actor.walk_frame() {
            0 => idle,
            1 => walk_a,
            _ => walk_b,
        };
        (frame, hflip)
    }

    // ── rendering ───────────────────────────────────────────────────────────

    /// Draw one 4-tile half of a metatile (`base` = 0 bottom layer, 4 top layer).
    fn draw_half(&self, fb: &mut FrameBuffer, entries: &[u16; 8], base: usize, ox: i32, oy: i32) {
        for q in 0..4 {
            let e = TileEntry::decode(entries[base + q]);
            let Some(tile) = self.map.tile(e.tile) else {
                continue;
            };
            let pal = self.map.palette(e.pal);
            let qx = ox + (q as i32 % 2) * TILE_I;
            let qy = oy + (q as i32 / 2) * TILE_I;
            for row in 0..8usize {
                let py = qy + row as i32;
                if py < 0 || py >= SCREEN_H {
                    continue;
                }
                let sy = if e.vflip { 7 - row } else { row };
                for col in 0..8usize {
                    let ci = tile[sy * 8 + if e.hflip { 7 - col } else { col }];
                    if ci == 0 {
                        continue; // transparent
                    }
                    let px = qx + col as i32;
                    if px < 0 || px >= SCREEN_W {
                        continue;
                    }
                    let c = pal[ci as usize];
                    if c.a == 0 {
                        continue;
                    }
                    fb.set_pixel(px as u32, py as u32, c);
                }
            }
        }
    }

    /// Draw a metatile's contribution to one pass (`over` = the layer in front of
    /// the player). See [`LayerType`] for the bottom/middle/top mapping.
    fn draw_metatile(&self, fb: &mut FrameBuffer, mx: i32, my: i32, cam_x: i32, cam_y: i32, over: bool) {
        let block = self.map.block_at(mx, my);
        let id = FireRedMap::block_metatile_id(block);
        let Some(metatile) = self.map.metatile(id) else {
            return;
        };
        let ox = mx * MT - cam_x;
        let oy = my * MT - cam_y;
        if over {
            // Top half draws over the player for NORMAL/SPLIT metatiles.
            if metatile.layer != LayerType::Covered {
                self.draw_half(fb, &metatile.entries, 4, ox, oy);
            }
        } else {
            // Bottom half always behind the player; COVERED's top half too.
            self.draw_half(fb, &metatile.entries, 0, ox, oy);
            if metatile.layer == LayerType::Covered {
                self.draw_half(fb, &metatile.entries, 4, ox, oy);
            }
        }
    }

    fn draw_player(&self, fb: &mut FrameBuffer, cam_x: i32, cam_y: i32) {
        let (frame, hflip) = self.player_frame();
        // 16×32 sprite: the lower 16px sits on the foot tile, the head extends
        // one tile up. Foot tile renders at (pos - cam); sprite top-left is 16px up.
        let screen_x = self.actor.px().round() as i32 - cam_x;
        let screen_y = self.actor.py().round() as i32 - cam_y - MT;
        for fy in 0..PLAYER_FRAME_H {
            let py = screen_y + fy as i32;
            if py < 0 || py >= SCREEN_H {
                continue;
            }
            for fx in 0..PLAYER_FRAME_W {
                let src_fx = if hflip { PLAYER_FRAME_W - 1 - fx } else { fx };
                let c = self.map.player_pixel(frame, src_fx, fy);
                if c.a == 0 {
                    continue;
                }
                let px = screen_x + fx as i32;
                if px < 0 || px >= SCREEN_W {
                    continue;
                }
                fb.set_pixel(px as u32, py as u32, c);
            }
        }
    }

    fn draw_debug(&self, fb: &mut FrameBuffer, cam_x: i32, cam_y: i32, mx0: i32, my0: i32, mx1: i32, my1: i32) {
        // Outline blocked metatiles in red, the player's tile in green.
        for my in my0..=my1 {
            for mx in mx0..=mx1 {
                if !self.map.is_blocked(mx, my) {
                    continue;
                }
                self.outline(fb, mx * MT - cam_x, my * MT - cam_y, Rgba::rgb(0xE0, 0x20, 0x20));
            }
        }
        let (ptx, pty) = self.actor.tile();
        self.outline(
            fb,
            ptx * MT - cam_x,
            pty * MT - cam_y,
            Rgba::rgb(0x20, 0xE0, 0x20),
        );
    }

    fn outline(&self, fb: &mut FrameBuffer, ox: i32, oy: i32, color: Rgba) {
        for i in 0..MT {
            for &(px, py) in &[(ox + i, oy), (ox + i, oy + MT - 1), (ox, oy + i), (ox + MT - 1, oy + i)] {
                if px >= 0 && px < SCREEN_W && py >= 0 && py < SCREEN_H {
                    fb.set_pixel(px as u32, py as u32, color);
                }
            }
        }
    }
}

impl Default for FireRedGame {
    fn default() -> Self {
        Self::new()
    }
}

impl GameLoop for FireRedGame {
    fn update(&mut self, input: &InputState) {
        let now = Instant::now();
        let dt = now.duration_since(self.last_frame);
        self.last_frame = now;

        if input.is_just_pressed(GbButton::Select) {
            self.show_debug = !self.show_debug;
        }

        // Drive the player through the generic overworld actor (FireRed has no
        // warps, so the reported arrival tile is ignored).
        let held = Self::held_direction(input);
        self.actor.update(held, &Collide(&self.map));

        self.center_camera();
        self.camera.update(dt.as_secs_f32().max(0.0));
    }

    fn draw(&mut self, fb: &mut FrameBuffer) {
        fb.clear(Rgba::BLACK);
        let cam_x = self.camera.position.x.round() as i32;
        let cam_y = self.camera.position.y.round() as i32;

        // Visible metatile range, padded by one for partial edges / tall sprites.
        let mx0 = cam_x.div_euclid(MT) - 1;
        let my0 = cam_y.div_euclid(MT) - 1;
        let mx1 = (cam_x + SCREEN_W).div_euclid(MT) + 1;
        let my1 = (cam_y + SCREEN_H).div_euclid(MT) + 1;

        // Pass 1: everything behind the player.
        for my in my0..=my1 {
            for mx in mx0..=mx1 {
                self.draw_metatile(fb, mx, my, cam_x, cam_y, false);
            }
        }
        // Pass 2: the player.
        self.draw_player(fb, cam_x, cam_y);
        // Pass 3: top layers that occlude the player (tree canopies, roofs).
        if self.overlay_top {
            for my in my0..=my1 {
                for mx in mx0..=mx1 {
                    self.draw_metatile(fb, mx, my, cam_x, cam_y, true);
                }
            }
        }

        if self.show_debug {
            self.draw_debug(fb, cam_x, cam_y, mx0, my0, mx1, my1);
        }
    }
}
