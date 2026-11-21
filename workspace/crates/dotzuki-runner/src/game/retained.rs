//! Damage tracking for hosts that retain their previous RGBA frame.
use super::*;
use dotzuki_engine::render::DirtyRegion;
use std::borrow::Cow;

#[derive(Default)]
pub(super) struct RetainedDraw {
    pub(super) target: usize,
    previous: Option<VisualState<'static>>,
    scratch: Option<FrameBuffer>,
    cursor: Option<list::ListCursor>,
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
    Panel(Panel, usize),
}

#[derive(Clone, Copy, PartialEq)]
enum Panel {
    Party,
    Bag,
    Target,
    Note,
    Shop,
    Battle,
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
            Self::Panel(panel, cursor) => Overlay::Panel(panel, cursor),
        }
    }

    fn bounds(&self) -> DirtyRegion {
        match self {
            Self::None => DirtyRegion::empty(),
            Self::Panel(..) => DirtyRegion::full(SCREEN_W as u32, SCREEN_H as u32),
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

#[derive(Clone, Copy, PartialEq)]
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

    fn cursor_change(&self, old: &Self) -> Option<usize> {
        if self.camera != old.camera
            || self.level != old.level
            || self.player != old.player
            || self.marker != old.marker
        {
            return None;
        }
        match (&self.overlay, &old.overlay) {
            (Overlay::RootMenu(new), Overlay::RootMenu(old)) if new != old => Some(*new),
            (Overlay::Panel(p, new), Overlay::Panel(q, old)) if p == q && new != old => Some(*new),
            _ => None,
        }
    }

    // Compare world-space actors after translating the retained pixels to the new camera.
    fn actors(&self, old: &Self, dx: i32, dy: i32) -> [DirtyRegion; 2] {
        let translate = |mut r: DirtyRegion| {
            r.x += dx;
            r.y += dy;
            r
        };
        let mut player = old.player;
        player.bounds = translate(player.bounds);
        let player = if self.player == player {
            DirtyRegion::empty()
        } else {
            self.player.bounds.union(&player.bounds)
        };
        let marker = old.marker.map(|(r, color)| (translate(r), color));
        let mut changed = DirtyRegion::empty();
        if self.marker != marker {
            for (r, _) in [self.marker, marker].into_iter().flatten() {
                changed = changed.union(&r);
            }
        }
        [player, changed]
    }

    fn damage(&self, old: &Self) -> DirtyRegion {
        if self.camera != old.camera || self.level != old.level {
            return DirtyRegion::full(SCREEN_W as u32, SCREEN_H as u32);
        }
        let [player, marker] = self.actors(old, 0, 0);
        let mut area = player.union(&marker);
        if self.overlay != old.overlay {
            area = area
                .union(&self.overlay.bounds())
                .union(&old.overlay.bounds());
        }
        area.clipped(SCREEN_W as u32, SCREEN_H as u32)
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
            Mode::Menu(s) => Overlay::Panel(
                match s.view {
                    menu::MenuView::Party => Panel::Party,
                    menu::MenuView::Bag => Panel::Bag,
                    menu::MenuView::BagTarget { .. } => Panel::Target,
                    menu::MenuView::Note { .. } => Panel::Note,
                    menu::MenuView::Root => unreachable!(),
                },
                s.cursor,
            ),
            Mode::Shop(s) => Overlay::Panel(Panel::Shop, s.cursor),
            Mode::Battle(s) => Overlay::Panel(Panel::Battle, s.battle.cursor()),
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
    /// Scrolling reuses the overlapping pixels but still changes the complete display.
    pub fn draw_retained(&mut self, fb: &mut FrameBuffer) -> DirtyRegion {
        let full = DirtyRegion::full(fb.width, fb.height);
        let target = fb.data.as_ptr() as usize;
        let next = self
            .visual_state()
            .filter(|_| (fb.width, fb.height) == (SCREEN_W as u32, SCREEN_H as u32));
        let Some(next) = next else {
            self.retained.invalidate();
            self.draw_full(fb);
            return full;
        };
        let old = self
            .retained
            .previous
            .as_ref()
            .filter(|_| self.retained.target == target);
        let damage = old.map_or(full, |old| next.damage(old));
        if !damage.present {
            fb.clear_dirty();
            return damage;
        }
        let cursor = old.and_then(|old| next.cursor_change(old));
        let scroll = old.and_then(|old| {
            let (dx, dy) = (old.camera.0 - next.camera.0, old.camera.1 - next.camera.1);
            ((dx != 0 || dy != 0)
                && dx.unsigned_abs() < fb.width
                && dy.unsigned_abs() < fb.height
                && old.level == next.level
                && matches!(
                    (&old.overlay, &next.overlay),
                    (Overlay::None, Overlay::None)
                )
                && self
                    .map
                    .as_ref()
                    .is_some_and(RuntimeMap::scrolls_with_camera))
            .then(|| (dx, dy, next.actors(old, dx, dy)))
        });
        let next = next.owned();
        let damage = if let (Some(row), Some(saved)) = (cursor, self.retained.cursor.as_mut()) {
            saved.move_to(fb, row)
        } else if let Some((dx, dy, actors)) = scroll {
            self.scroll_map(fb, dx, dy, actors);
            full
        } else {
            if damage == full {
                if !matches!(self.mode, Mode::Battle(_)) {
                    self.draw_map_region(fb, (0, 0));
                }
            } else {
                self.repaint_map_region(fb, damage);
            }
            self.retained.cursor = self.draw_overlay(fb, true);
            damage
        };
        self.retained.target = target;
        self.retained.previous = Some(next);
        fb.dirty_region = damage;
        damage
    }

    fn repaint_map_region(&mut self, fb: &mut FrameBuffer, area: DirtyRegion) {
        let r = area.clipped(fb.width, fb.height);
        if !r.present {
            return;
        }
        let mut patch = self.retained.scratch.take().unwrap_or_else(|| {
            FrameBuffer::new(
                dotzuki_engine::render_config::RenderConfig::new(r.width, r.height),
                Rgba::BLACK,
            )
        });
        patch.width = r.width;
        patch.height = r.height;
        let stride = r.width as usize * 4;
        patch.data.resize(stride * r.height as usize, 0);
        self.draw_map_region(&mut patch, (r.x, r.y));
        for (y, row) in patch.data.chunks_exact(stride).enumerate() {
            fb.blit_row(r.x as u32, r.y as u32 + y as u32, row, r.width);
        }
        self.retained.scratch = Some(patch);
    }

    fn scroll_map(&mut self, fb: &mut FrameBuffer, dx: i32, dy: i32, actors: [DirtyRegion; 2]) {
        // One overlapping move shifts every surviving row. Wrapped pixels lie
        // in the newly exposed strips and are replaced below.
        let offset = (dy * fb.width as i32 + dx) * 4;
        let count = fb.data.len() - offset.unsigned_abs() as usize;
        let src = (-offset).max(0) as usize;
        fb.data
            .copy_within(src..src + count, offset.max(0) as usize);
        let w = dx.unsigned_abs();
        let h = dy.unsigned_abs();
        let x = if dx < 0 { (fb.width - w) as i32 } else { 0 };
        let y = if dy < 0 { (fb.height - h) as i32 } else { 0 };
        self.repaint_map_region(fb, DirtyRegion::new(0, y, fb.width, h));
        self.repaint_map_region(fb, DirtyRegion::new(x, dy.max(0), w, fb.height - h));
        for area in actors {
            self.repaint_map_region(fb, area);
        }
    }
}
