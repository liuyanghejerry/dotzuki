//! The same flex list is used by the pause menu, shops and battle menus.
use super::{DIALOG_AREA, SCREEN_W};
use dotzuki_engine::menu::MenuConfig;
use dotzuki_engine::render::{DirtyRegion, FrameBuffer, Rgba, TileRect, Ui};
use dotzuki_renderer::embedded_font;
use dotzuki_ui::widgets::{draw_flex_menu, FlexMenuState};
use dotzuki_ui::FrameBufferPainter;

pub(crate) enum Placement {
    Corner,
    CornerWithPrompt,
    AboveDialogue,
}

/// Pixels underneath the cursor. Restoring them preserves labels in any font.
pub(crate) struct ListCursor {
    x: u32,
    top: u32,
    rows: usize,
    under: [u8; 8 * 9 * 4],
    area: DirtyRegion,
}

impl ListCursor {
    fn paint(&mut self, fb: &mut FrameBuffer, row: usize) {
        self.area = DirtyRegion::empty();
        if row >= self.rows || row >= fb.height as usize / 8 {
            return;
        }
        let y = self.top + row as u32 * 8;
        // The renderer's ▶ glyph occupies eight columns, offset one pixel down.
        self.area = DirtyRegion::new(self.x as i32, y as i32, 8, 9).clipped(fb.width, fb.height);
        fb.copy_region(self.area, &mut self.under);
        embedded_font::draw_char('▶', self.x, y, Rgba::INK_BLACK, fb);
    }

    pub(super) fn move_to(&mut self, fb: &mut FrameBuffer, row: usize) -> DirtyRegion {
        let old = self.area;
        if old.present {
            let stride = old.width as usize * 4;
            for y in 0..old.height as usize {
                fb.blit_row(
                    old.x as u32,
                    old.y as u32 + y as u32,
                    &self.under[y * stride..],
                    old.width,
                );
            }
        }
        self.paint(fb, row);
        old.union(&self.area)
    }
}

pub(crate) fn draw_list(
    fb: &mut FrameBuffer,
    items: &[String],
    cursor: usize,
    placement: Placement,
    retain: bool,
) -> Option<ListCursor> {
    let n = items.len() as u32;
    if n == 0 {
        return None;
    }
    let max_len = items.iter().map(|s| s.chars().count()).max().unwrap_or(1) as u32;
    let (min_w, ty) = match placement {
        Placement::AboveDialogue => (10, DIALOG_AREA.ty.saturating_sub(n + 2)),
        _ => (8, 1),
    };
    let w = (max_len + 4).clamp(min_w, 24);
    let tx = SCREEN_W as u32 / 8 - w;
    let config = MenuConfig::new(
        TileRect::new(tx, ty, w, n + 2),
        None,
        TileRect::new(tx + 1, ty + 1, w - 2, n),
        Default::default(),
    );
    // A later textbox can cover a long shop/target list. Let the full painter
    // preserve that layering whenever a cursor could reach the prompt.
    let capture = retain
        && !(matches!(placement, Placement::CornerWithPrompt)
            && (ty + 1 + n) * 8 + 1 > DIALOG_AREA.ty * 8);
    let state = FlexMenuState {
        cursor: if capture { usize::MAX } else { cursor },
        scroll_offset: 0,
    };
    let mut painter = FrameBufferPainter::new(fb);
    draw_flex_menu(
        items,
        &[config],
        &state,
        items.len(),
        &mut Ui::new(&mut painter),
    );
    if !capture {
        return None;
    }
    let mut image = ListCursor {
        x: (tx + 1) * 8,
        top: (ty + 1) * 8,
        rows: items.len(),
        under: [0; 8 * 9 * 4],
        area: DirtyRegion::empty(),
    };
    image.paint(fb, cursor);
    Some(image)
}
