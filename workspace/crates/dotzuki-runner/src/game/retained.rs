//! Damage tracking for hosts that retain their previous RGBA frame.
use super::*;
use dotzuki_engine::render::DirtyRegion;
use std::borrow::Cow;

#[derive(Default)]
pub(super) struct RetainedDraw {
    pub(super) target: usize,
    previous: Option<VisualState<'static>>,
    scratch: Option<FrameBuffer>,
}

impl RetainedDraw {
    pub(super) fn invalidate(&mut self) {
        self.previous = None;
    }
}

#[derive(PartialEq)]
enum Overlay<'a> {
    None,
    Text(Cow<'a, str>),
    Choice(Cow<'a, str>, Cow<'a, [String]>, usize),
    RootMenu(usize),
}

impl<'a> Overlay<'a> {
    fn owned(self) -> Overlay<'static> {
        match self {
            Self::None => Overlay::None,
            Self::Text(text) => Overlay::Text(Cow::Owned(text.into_owned())),
            Self::Choice(text, options, cursor) => Overlay::Choice(
                Cow::Owned(text.into_owned()),
                Cow::Owned(options.into_owned()),
                cursor,
            ),
            Self::RootMenu(cursor) => Overlay::RootMenu(cursor),
        }
    }

    fn bounds(&self) -> DirtyRegion {
        match self {
            Self::None => DirtyRegion::empty(),
            Self::Text(_) => DirtyRegion::new(
                0,
                (DIALOG_AREA.ty * 8) as i32,
                SCREEN_W as u32,
                DIALOG_AREA.th * 8,
            ),
            Self::Choice(_, choices, _) => {
                let top = DIALOG_AREA.ty.saturating_sub(choices.len() as u32 + 2) * 8;
                DirtyRegion::new(0, top as i32, SCREEN_W as u32, SCREEN_H as u32 - top)
            }
            // The four fixed labels use the corner menu's maximum 24 columns.
            Self::RootMenu(_) => DirtyRegion::new(SCREEN_W - 24 * 8, 8, 24 * 8, 6 * 8),
        }
    }
}

#[derive(PartialEq)]
struct SpriteImage {
    bounds: DirtyRegion,
    row: u32,
    col: u32,
}

struct VisualState<'a> {
    camera: (i32, i32),
    level: u8,
    player: SpriteImage,
    marker: Option<(DirtyRegion, Rgba)>,
    overlay: Overlay<'a>,
}

impl VisualState<'_> {
    fn owned(self) -> VisualState<'static> {
        VisualState {
            camera: self.camera,
            level: self.level,
            player: self.player,
            marker: self.marker,
            overlay: self.overlay.owned(),
        }
    }

    fn damage(&self, old: &VisualState<'_>) -> DirtyRegion {
        if self.camera != old.camera || self.level != old.level {
            return DirtyRegion::full(SCREEN_W as u32, SCREEN_H as u32);
        }
        let mut area = DirtyRegion::empty();
        if self.player != old.player {
            area = self.player.bounds.union(&old.player.bounds);
        }
        if self.marker != old.marker {
            for (bounds, _) in [old.marker, self.marker].into_iter().flatten() {
                area = area.union(&bounds);
            }
        }
        if self.overlay != old.overlay {
            area = area
                .union(&self.overlay.bounds())
                .union(&old.overlay.bounds());
        }
        if !area.present {
            return area;
        }
        let x = area.x.clamp(0, SCREEN_W);
        let y = area.y.clamp(0, SCREEN_H);
        let right = (area.x + area.width as i32).clamp(x, SCREEN_W);
        let bottom = (area.y + area.height as i32).clamp(y, SCREEN_H);
        if right == x || bottom == y {
            DirtyRegion::empty()
        } else {
            DirtyRegion::new(x, y, (right - x) as u32, (bottom - y) as u32)
        }
    }
}

impl RunnerGame {
    fn visual_state(&self) -> Option<VisualState<'_>> {
        if self.transition.is_some() || self.flash > 0 {
            return None;
        }
        let overlay = match &self.mode {
            Mode::Overworld | Mode::Delay(_) => Overlay::None,
            Mode::Text(s) => Overlay::Text(Cow::Borrowed(
                s.pages.front().map(String::as_str).unwrap_or(""),
            )),
            Mode::Choice(s) => Overlay::Choice(
                Cow::Borrowed(&s.context_text),
                Cow::Borrowed(&s.options),
                s.cursor,
            ),
            Mode::Menu(s) if matches!(s.view, menu::MenuView::Root) => Overlay::RootMenu(s.cursor),
            _ => return None,
        };
        let camera = self.camera_pixels();
        let tile = self.map.as_ref().map_or(16, |m| m.tile_size().0 as i32);
        let (w, h, col) = self.player_sprite.as_ref().map_or((12, 14, 0), |sprite| {
            (
                sprite.frame_w,
                sprite.frame_h,
                frame_col(
                    self.actor.locomotion(),
                    self.actor.step_phase(),
                    sprite.cols,
                ),
            )
        });
        let x = self.actor.px().round() as i32 - camera.0 + (tile - w as i32) / 2;
        let y = self.actor.py().round() as i32 - camera.1 + tile - h as i32;
        let player = SpriteImage {
            bounds: DirtyRegion::new(x, y, w, h),
            row: self.actor.facing_row(),
            col,
        };
        let marker = self.navigation_marker().map(|((x, y), color)| {
            (
                DirtyRegion::new(
                    x * tile - camera.0,
                    y * tile - camera.1,
                    tile as u32,
                    tile as u32,
                ),
                color,
            )
        });
        Some(VisualState {
            camera,
            level: self.actor.elevation(),
            player,
            marker,
            overlay,
        })
    }

    /// Update the same unmodified framebuffer across draws and return its changed bounds.
    /// Call [`Self::draw`] when replacing or modifying the output surface.
    /// Camera, elevation, map and full-screen effects invalidate the whole viewport.
    pub fn draw_retained(&mut self, fb: &mut FrameBuffer) -> DirtyRegion {
        let full = DirtyRegion::full(fb.width, fb.height);
        let target = fb.data.as_ptr() as usize;
        if (fb.width, fb.height) != (SCREEN_W as u32, SCREEN_H as u32) {
            self.retained.previous = None;
            self.draw_full(fb);
            return full;
        }
        let Some(next) = self.visual_state() else {
            self.retained.previous = None;
            self.draw_full(fb);
            return full;
        };
        let damage = self
            .retained
            .previous
            .as_ref()
            .filter(|_| self.retained.target == target)
            .map_or(full, |old| next.damage(old));
        if !damage.present {
            fb.clear_dirty();
            return damage;
        }
        let next = next.owned();
        if damage == full {
            self.draw_full(fb);
        } else {
            let mut scratch = self.retained.scratch.take().unwrap_or_else(|| {
                FrameBuffer::new(
                    dotzuki_engine::render_config::RenderConfig::new(damage.width, damage.height),
                    Rgba::BLACK,
                )
            });
            scratch.width = damage.width;
            scratch.height = damage.height;
            let stride = damage.width as usize * 4;
            scratch.data.resize(stride * damage.height as usize, 0);
            self.draw_map_region(&mut scratch, (damage.x, damage.y));
            for (y, row) in scratch.data.chunks_exact(stride).enumerate() {
                let start = ((damage.y as usize + y) * fb.width as usize + damage.x as usize) * 4;
                fb.data[start..start + stride].copy_from_slice(row);
            }
            self.retained.scratch = Some(scratch);
            self.draw_overlay(fb);
        }
        self.retained.target = target;
        self.retained.previous = Some(next);
        fb.dirty_region = damage;
        damage
    }
}
