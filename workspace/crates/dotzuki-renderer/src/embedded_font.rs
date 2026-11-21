//! Embedded 10px bitmap font — Fusion Pixel 10px Monospaced (OFL-1.1).
//!
//! Latin glyphs: 5px half-width (advance=5), CJK glyphs: 10px full-width (advance=10).
//! Glyph data is generated at build time from BDF files by `build.rs`.
//!
//! All text rendering funnels through `draw_text()` which auto-dispatches
//! Latin vs CJK based on character codepoint.

use crate::FbSurface;
use dotzuki_engine::render::Rgba;

/// Default line height in pixels (Fusion Pixel 10px baseline-to-baseline).
pub const GLYPH_SIZE: u32 = 10;
/// Baseline offset for CJK glyph positioning.
const CJK_BASELINE: i32 = 2;

// ── Generated Glyph Data ──────────────────────────────────────────

/// Compact binary glyph blob baked by `build.rs` from the Fusion Pixel BDF
/// (full ~24k-char repertoire). Layout (little-endian):
///   u32 count
///   count × { u32 codepoint, u32 data_offset }   (sorted ascending by codepoint)
///   per glyph @ data_offset:
///     u8 width, u8 nrows, i16 x_off, i16 y_off, u8 advance, (u16 × nrows) rows
static GLYPH_BLOB: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/glyphs.bin"));
include!(concat!(env!("OUT_DIR"), "/ascii_glyph_offsets.rs"));

#[inline]
fn blob_u32(off: usize) -> u32 {
    u32::from_le_bytes([
        GLYPH_BLOB[off],
        GLYPH_BLOB[off + 1],
        GLYPH_BLOB[off + 2],
        GLYPH_BLOB[off + 3],
    ])
}

// ── Runtime Glyph Info ────────────────────────────────────────────

struct GlyphInfo {
    width: u32,
    x_off: i32,
    y_off: i32,
    advance: u32,
    /// Raw little-endian u16 bitmap rows (`height` rows, 2 bytes each), borrowed
    /// from `GLYPH_BLOB`.
    rows: &'static [u8],
}

fn lookup_glyph(ch: char) -> Option<GlyphInfo> {
    let cp = ch as u32;
    let off = if cp < ASCII_GLYPH_OFFSETS.len() as u32 {
        let off = ASCII_GLYPH_OFFSETS[cp as usize];
        if off == u32::MAX {
            return None;
        }
        off as usize
    } else {
        let count = blob_u32(0) as usize;
        // Binary search the codepoint-sorted index (8 bytes/entry, starting at offset 4).
        let (mut lo, mut hi) = (0usize, count);
        loop {
            if lo >= hi {
                return None;
            }
            let mid = lo + (hi - lo) / 2;
            let entry = 4 + mid * 8;
            let mcp = blob_u32(entry);
            if mcp < cp {
                lo = mid + 1;
            } else if mcp > cp {
                hi = mid;
            } else {
                break blob_u32(entry + 4) as usize;
            }
        }
    };
    let width = GLYPH_BLOB[off] as u32;
    let nrows = GLYPH_BLOB[off + 1] as usize;
    let x_off = i16::from_le_bytes([GLYPH_BLOB[off + 2], GLYPH_BLOB[off + 3]]) as i32;
    let y_off = i16::from_le_bytes([GLYPH_BLOB[off + 4], GLYPH_BLOB[off + 5]]) as i32;
    let advance = GLYPH_BLOB[off + 6] as u32;
    let rows = &GLYPH_BLOB[off + 7..off + 7 + nrows * 2];
    Some(GlyphInfo {
        width,
        x_off,
        y_off,
        advance,
        rows,
    })
}

/// Returns true if the character has a CJK-width glyph (advance >= 10).
pub fn is_cjk(ch: char) -> bool {
    lookup_glyph(ch).map_or(false, |g| g.advance >= 10)
}

/// The pixel advance width of `ch` — the amount the cursor moves after drawing
/// it. Latin (half-width) → 5, CJK (full-width) → 10, the ▶/▼ cursor fallbacks →
/// 10, unknown → 0. This is the single source of truth for proportional text
/// measurement (see [`measure_text`] and the layout engine's proportional mode).
pub fn char_advance(ch: char) -> u32 {
    if ch == '▶' || ch == '▼' {
        return 10;
    }
    lookup_glyph(ch).map_or(0, |g| g.advance)
}

/// The total pixel width of `text` (sum of [`char_advance`] over its chars).
pub fn measure_text(text: &str) -> u32 {
    text.chars().map(char_advance).sum()
}

// ── Fallback Cursor Glyphs ────────────────────────────────────────

// 8×8 fallback bitmaps for the cursor arrows (not in the BDF blob). The
// Fusion Pixel baseline sinks text ink to tile rows 3..=9 (Latin) / 1..=9
// (CJK) — center 6.0 — so the ▶ triangle occupies rows 3..=7 and is drawn
// one extra pixel lower (see draw_char) to land its center on the same row
// 6.0 instead of floating ~2.5px above the text line.
const GLYPH_CURSOR_RIGHT: [u8; 8] = [
    0b00000000, 0b00000000, 0b00000000, 0b01111000, 0b01111100, 0b01111110, 0b01111100, 0b01111000,
];
const GLYPH_CURSOR_DOWN: [u8; 8] = [
    0b00000000, 0b00000000, 0b01111110, 0b01111110, 0b00111100, 0b00011000, 0b00000000, 0b00000000,
];

/// Store the fallback rows in the same little-endian format as the font blob.
const fn cursor_rows(rows: [u8; 8]) -> [u8; 16] {
    let mut bytes = [0; 16];
    let mut i = 0;
    while i < rows.len() {
        bytes[i * 2] = rows[i];
        i += 1;
    }
    bytes
}
const RIGHT_ROWS: [u8; 16] = cursor_rows(GLYPH_CURSOR_RIGHT);
const DOWN_ROWS: [u8; 16] = cursor_rows(GLYPH_CURSOR_DOWN);

fn drawing_glyph(ch: char) -> Option<GlyphInfo> {
    let (rows, top) = match ch {
        '▶' => (&RIGHT_ROWS, 1),
        '▼' => (&DOWN_ROWS, 0),
        _ => return lookup_glyph(ch),
    };
    Some(GlyphInfo {
        width: 8,
        x_off: 0,
        y_off: top - CJK_BASELINE,
        advance: 10,
        rows,
    })
}

impl GlyphInfo {
    fn draw(
        &self,
        x: u32,
        y: u32,
        scale: u32,
        size: (u32, u32),
        write: &mut impl FnMut(u32, u32, u16, u32),
    ) {
        if scale == 1 {
            let left = i64::from(x) + i64::from(self.x_off);
            let width = (i64::from(self.width) + left.min(0)).max(0) as u32;
            if width == 0 || left >= i64::from(size.0) {
                return;
            }
            let left = left.max(0) as u32;
            let top = i64::from(y) + i64::from(self.y_off + CJK_BASELINE);
            let first = (-top).max(0) as usize;
            let end = (i64::from(size.1) - top).clamp(0, (self.rows.len() / 2) as i64) as usize;
            if first < end {
                let mut py = (top + first as i64) as u32;
                for bytes in self.rows[first * 2..end * 2].chunks_exact(2) {
                    let bits = u16::from_le_bytes([bytes[0], bytes[1]]);
                    if bits != 0 {
                        write(left, py, bits, width);
                    }
                    py += 1;
                }
            }
            return;
        }
        let scale = i64::from(scale);
        for (row, bytes) in self.rows.chunks_exact(2).enumerate() {
            let bits = u16::from_le_bytes([bytes[0], bytes[1]]);
            let top = i64::from(y) + (row as i64 + i64::from(self.y_off + CJK_BASELINE)) * scale;
            for col in 0..self.width {
                if bits & (1 << (self.width - 1 - col)) == 0 {
                    continue;
                }
                let left = i64::from(x) + (i64::from(self.x_off) + i64::from(col)) * scale;
                let end = (left + scale).min(i64::from(size.0));
                for py in top.max(0)..(top + scale).min(i64::from(size.1)) {
                    let mut px = left.max(0);
                    while px < end {
                        let len = (end - px).min(16);
                        write(px as u32, py as u32, u16::MAX, len as u32);
                        px += len;
                    }
                }
            }
        }
    }
}

/// Draw a single character. Returns its advance in pixels (zero for a missing glyph).
pub fn draw_char(ch: char, x: u32, y: u32, color: Rgba, fb: &mut impl FbSurface) -> u32 {
    draw_char_scaled(ch, x, y, 1, color, fb)
}

/// Draw a line of text at pixel (x, y), clipped to the framebuffer width.
pub fn draw_text(text: &str, x: u32, y: u32, color: Rgba, fb: &mut impl FbSurface) {
    draw_text_scaled(text, x, y, 1, color, fb);
}

/// Draw one character at integer scale and return its scaled advance.
pub fn draw_char_scaled(
    ch: char,
    x: u32,
    y: u32,
    scale: u32,
    color: Rgba,
    fb: &mut impl FbSurface,
) -> u32 {
    let Some(glyph) = drawing_glyph(ch) else {
        return 0;
    };
    let scale = scale.max(1);
    let size = (fb.width(), fb.height());
    glyph.draw(x, y, scale, size, &mut fb.glyph_row_writer(color));
    glyph.advance.saturating_mul(scale)
}

/// Draw a line at integer scale. Indexed surfaces quantize the text color once per line.
pub fn draw_text_scaled(
    text: &str,
    mut x: u32,
    y: u32,
    scale: u32,
    color: Rgba,
    fb: &mut impl FbSurface,
) {
    let scale = scale.max(1);
    let size = (fb.width(), fb.height());
    let mut write = fb.glyph_row_writer(color);
    for ch in text.chars() {
        if x >= size.0 {
            break;
        }
        if let Some(glyph) = drawing_glyph(ch) {
            glyph.draw(x, y, scale, size, &mut write);
            x = x.saturating_add(glyph.advance.saturating_mul(scale));
        }
    }
}

/// The pixel width of `text` when drawn at `scale` (i.e. [`measure_text`] × scale).
pub fn measure_text_scaled(text: &str, scale: u32) -> u32 {
    measure_text(text) * scale.max(1)
}

/// 8×8 bitmap tiles for Game Boy-style text box borders (rounded corners, 1px lines).
pub mod box_tiles {
    /// ┌
    pub const TOP_LEFT: [u8; 8] = [
        0b00000000, 0b00001111, 0b00011111, 0b00110000, 0b00100000, 0b01100000, 0b01000000,
        0b01000000,
    ];
    /// ┐
    pub const TOP_RIGHT: [u8; 8] = [
        0b00000000, 0b11110000, 0b11111000, 0b00001100, 0b00000100, 0b00000110, 0b00000010,
        0b00000010,
    ];
    /// └
    pub const BOTTOM_LEFT: [u8; 8] = [
        0b01000000, 0b01000000, 0b01100000, 0b00100000, 0b00110000, 0b00011111, 0b00001111,
        0b00000000,
    ];
    /// ┘
    pub const BOTTOM_RIGHT: [u8; 8] = [
        0b00000010, 0b00000010, 0b00000110, 0b00000100, 0b00001100, 0b11111000, 0b11110000,
        0b00000000,
    ];
    /// ─ (top edge)
    pub const HORIZONTAL: [u8; 8] = [
        0b00000000, 0b11111111, 0b11111111, 0b00000000, 0b00000000, 0b00000000, 0b00000000,
        0b00000000,
    ];
    /// ─ (bottom edge)
    pub const HORIZONTAL_BOTTOM: [u8; 8] = [
        0b00000000, 0b00000000, 0b00000000, 0b00000000, 0b00000000, 0b11111111, 0b11111111,
        0b00000000,
    ];
    /// │ (left edge)
    pub const VERTICAL_LEFT: [u8; 8] = [
        0b01100000, 0b01100000, 0b01100000, 0b01100000, 0b01100000, 0b01100000, 0b01100000,
        0b01100000,
    ];
    /// │ (right edge)
    pub const VERTICAL_RIGHT: [u8; 8] = [
        0b00000110, 0b00000110, 0b00000110, 0b00000110, 0b00000110, 0b00000110, 0b00000110,
        0b00000110,
    ];

    /// Transparency masks for the border tiles above: set bits mark pixels that
    /// lie OUTSIDE the box outline. [`crate::embedded_font::draw_box_tile`]
    /// leaves these pixels untouched so the scene behind the box shows through
    /// instead of being painted over with the background color.
    pub mod outside {
        /// ┌ — everything above/left of the rounded corner stroke.
        pub const TOP_LEFT: [u8; 8] = [
            0b11111111, 0b11110000, 0b11100000, 0b11000000, 0b11000000, 0b10000000, 0b10000000,
            0b10000000,
        ];
        /// ┐ — everything above/right of the rounded corner stroke.
        pub const TOP_RIGHT: [u8; 8] = [
            0b11111111, 0b00001111, 0b00000111, 0b00000011, 0b00000011, 0b00000001, 0b00000001,
            0b00000001,
        ];
        /// └ — everything below/left of the rounded corner stroke.
        pub const BOTTOM_LEFT: [u8; 8] = [
            0b10000000, 0b10000000, 0b10000000, 0b11000000, 0b11000000, 0b11100000, 0b11110000,
            0b11111111,
        ];
        /// ┘ — everything below/right of the rounded corner stroke.
        pub const BOTTOM_RIGHT: [u8; 8] = [
            0b00000001, 0b00000001, 0b00000001, 0b00000011, 0b00000011, 0b00000111, 0b00001111,
            0b11111111,
        ];
        /// ─ (top edge) — the row above the stroke.
        pub const HORIZONTAL: [u8; 8] = [
            0b11111111, 0b00000000, 0b00000000, 0b00000000, 0b00000000, 0b00000000, 0b00000000,
            0b00000000,
        ];
        /// ─ (bottom edge) — the row below the stroke.
        pub const HORIZONTAL_BOTTOM: [u8; 8] = [
            0b00000000, 0b00000000, 0b00000000, 0b00000000, 0b00000000, 0b00000000, 0b00000000,
            0b11111111,
        ];
        /// │ (left edge) — the column left of the stroke.
        pub const VERTICAL_LEFT: [u8; 8] = [
            0b10000000, 0b10000000, 0b10000000, 0b10000000, 0b10000000, 0b10000000, 0b10000000,
            0b10000000,
        ];
        /// │ (right edge) — the column right of the stroke.
        pub const VERTICAL_RIGHT: [u8; 8] = [
            0b00000001, 0b00000001, 0b00000001, 0b00000001, 0b00000001, 0b00000001, 0b00000001,
            0b00000001,
        ];
    }
}

pub fn draw_glyph(glyph: &[u8; 8], x: u32, y: u32, color: Rgba, bg: Rgba, fb: &mut impl FbSurface) {
    let fb_h = fb.height();
    let fb_w = fb.width();
    for row in 0..8u32 {
        let py = y + row;
        if py >= fb_h {
            break;
        }
        let byte = glyph[row as usize];
        for col in 0..8u32 {
            let px = x + col;
            if px >= fb_w {
                break;
            }
            if byte & (0x80 >> col) != 0 {
                fb.set_pixel(px, py, color);
            } else {
                fb.set_pixel(px, py, bg);
            }
        }
    }
}

pub fn fill_tile(x: u32, y: u32, color: Rgba, fb: &mut impl FbSurface) {
    let fb_h = fb.height();
    let fb_w = fb.width();
    for row in 0..8u32 {
        let py = y + row;
        if py >= fb_h {
            break;
        }
        for col in 0..8u32 {
            let px = x + col;
            if px >= fb_w {
                break;
            }
            fb.set_pixel(px, py, color);
        }
    }
}

/// Draw a box-border tile (see [`box_tiles`]): `color` on stroke pixels, `bg`
/// on interior pixels, and leaves pixels marked in `outside` untouched so the
/// scene behind the box shows through beyond the border line. Pair each tile
/// with its mask from [`box_tiles::outside`].
pub fn draw_box_tile(
    glyph: &[u8; 8],
    outside: &[u8; 8],
    x: u32,
    y: u32,
    color: Rgba,
    bg: Rgba,
    fb: &mut impl FbSurface,
) {
    let fb_h = fb.height();
    let fb_w = fb.width();
    for row in 0..8u32 {
        let py = y + row;
        if py >= fb_h {
            break;
        }
        let byte = glyph[row as usize];
        let out = outside[row as usize];
        for col in 0..8u32 {
            let px = x + col;
            if px >= fb_w {
                break;
            }
            let mask = 0x80 >> col;
            if out & mask != 0 {
                continue;
            }
            if byte & mask != 0 {
                fb.set_pixel(px, py, color);
            } else {
                fb.set_pixel(px, py, bg);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::FrameBuffer;
    use dotzuki_engine::render_config::RenderConfig;

    #[test]
    fn indexed_dialogue_matches_rgba_ink_during_a_palette_fade() {
        use crate::palette::{ColorIndex, GbColor, GbaColor, Palette};
        use crate::{quantize, DefaultPalette, RgbaIndexedFrameBuffer};

        fn check<C: ColorIndex + DefaultPalette, const LINEAR: bool>(base: Palette<C>) {
            let config = RenderConfig::new(95, 17);
            let ink = Rgba::rgb(49, 36, 61);
            let blank = Rgba::rgb(255, 240, 222);
            let text = "A你▶好▼🦀 桥Lv12 道具";
            let mut mask = FrameBuffer::new(config, Rgba::WHITE);
            draw_text(text, 0, 0, Rgba::BLACK, &mut mask);
            let (foreground, background) = (quantize(&base, ink), quantize(&base, blank));
            assert_ne!(foreground, background);
            for scale in [1, 2, 3] {
                let mut fb = RgbaIndexedFrameBuffer::<C, LINEAR>::with_palette(config, blank, base);
                fb.scale_shades(0.0);
                draw_text_scaled(text, 2, 3, scale, ink, &mut fb);
                for y in 0..17 {
                    for x in 0..95 {
                        let covered = x >= 2
                            && y >= 3
                            && mask.get_pixel((x - 2) / scale, (y - 3) / scale)
                                == Some(Rgba::BLACK);
                        let index = if covered { foreground } else { background };
                        assert_eq!(
                            fb.get_index(x, y),
                            Some(index),
                            "at ({x},{y}), scale {scale}"
                        );
                        assert_eq!(fb.get_pixel(x, y), Some(Rgba::BLACK));
                    }
                }
            }
        }
        let four = [
            Rgba::rgb(255, 240, 222),
            Rgba::rgb(200, 187, 145),
            Rgba::rgb(97, 104, 93),
            Rgba::rgb(38, 31, 49),
        ];
        check::<GbColor, false>(Palette::new(&four));
        check::<GbColor, true>(Palette::new(&four));
        let sixteen = core::array::from_fn::<_, 16, _>(|i| {
            Rgba::rgb((17 * i) as u8, (13 * i) as u8, (11 * i) as u8)
        });
        check::<GbaColor, false>(Palette::new(&sixteen));
        check::<GbaColor, true>(Palette::new(&sixteen));
    }

    #[test]
    fn draw_text_does_not_panic() {
        let mut fb = FrameBuffer::new(RenderConfig::new(160, 144), Rgba::WHITE);
        draw_text("Hello, World!", 0, 0, Rgba::BLACK, &mut fb);
        draw_text("Edge", 150, 140, Rgba::BLACK, &mut fb);
        draw_text("", 0, 0, Rgba::BLACK, &mut fb);
    }

    #[test]
    fn draw_text_sets_pixels() {
        let mut fb = FrameBuffer::new(RenderConfig::new(160, 144), Rgba::WHITE);
        draw_text("A", 0, 0, Rgba::BLACK, &mut fb);
        let has_black = (0..12).any(|y| (0..10).any(|x| fb.get_pixel(x, y) == Some(Rgba::BLACK)));
        assert!(has_black, "Drawing 'A' should set at least one black pixel");
    }

    #[test]
    fn cjk_lookup_and_is_cjk() {
        assert!(is_cjk('你'));
        assert!(is_cjk('好'));
        assert!(!is_cjk('A'));
        assert!(!is_cjk(' '));
    }

    #[test]
    fn draw_char_returns_advance() {
        let mut fb = FrameBuffer::new(RenderConfig::new(160, 144), Rgba::WHITE);
        let adv_a = draw_char('A', 0, 0, Rgba::BLACK, &mut fb);
        let adv_ni = draw_char('你', 50, 0, Rgba::BLACK, &mut fb);
        assert_eq!(adv_a, 5); // Latin half-width
        assert_eq!(adv_ni, 10); // CJK full-width
    }

    #[test]
    fn cursor_right_fallback_centers_on_text_ink() {
        // The Fusion Pixel baseline sinks glyph ink below the tile top (Latin
        // caps span tile rows 3..=9 → center 6.0); the hardcoded ▶ fallback
        // must center on the same row or menu cursors float above the line.
        let mut fb = FrameBuffer::new(RenderConfig::new(160, 144), Rgba::WHITE);
        draw_char('▶', 0, 0, Rgba::BLACK, &mut fb);
        draw_char('M', 16, 0, Rgba::BLACK, &mut fb);
        let ink_center = |x0: u32| {
            let rows: Vec<u32> = (0..12)
                .filter(|&y| (0..8).any(|x| fb.get_pixel(x0 + x, y) == Some(Rgba::BLACK)))
                .collect();
            (*rows.first().unwrap() + *rows.last().unwrap()) as f64 / 2.0
        };
        let (cursor, text) = (ink_center(0), ink_center(16));
        assert!(
            (cursor - text).abs() <= 0.5,
            "▶ ink center {cursor} should match text ink center {text}"
        );
    }

    #[test]
    fn draw_text_mixed_pixels() {
        let mut fb = FrameBuffer::new(RenderConfig::new(160, 144), Rgba::WHITE);
        draw_text("Hello你好", 0, 0, Rgba::BLACK, &mut fb);
        // 'H' at x=0: Latin 5px half-width, '你' starts at x=5*5=25
        assert!(fb.get_pixel(0, 3) == Some(Rgba::BLACK), "H left stroke");
        let has_cjk = (25..45).any(|x| (0..12).any(|y| fb.get_pixel(x, y) == Some(Rgba::BLACK)));
        assert!(has_cjk, "你/好 should render in x=25..44");
    }

    #[test]
    fn box_tiles_outside_masks_disjoint_from_strokes() {
        let pairs = [
            (&box_tiles::TOP_LEFT, &box_tiles::outside::TOP_LEFT),
            (&box_tiles::TOP_RIGHT, &box_tiles::outside::TOP_RIGHT),
            (&box_tiles::BOTTOM_LEFT, &box_tiles::outside::BOTTOM_LEFT),
            (&box_tiles::BOTTOM_RIGHT, &box_tiles::outside::BOTTOM_RIGHT),
            (&box_tiles::HORIZONTAL, &box_tiles::outside::HORIZONTAL),
            (
                &box_tiles::HORIZONTAL_BOTTOM,
                &box_tiles::outside::HORIZONTAL_BOTTOM,
            ),
            (
                &box_tiles::VERTICAL_LEFT,
                &box_tiles::outside::VERTICAL_LEFT,
            ),
            (
                &box_tiles::VERTICAL_RIGHT,
                &box_tiles::outside::VERTICAL_RIGHT,
            ),
        ];
        for (glyph, outside) in pairs {
            for row in 0..8 {
                assert_eq!(
                    glyph[row] & outside[row],
                    0,
                    "outside mask overlaps the stroke at row {row}"
                );
            }
        }
    }

    #[test]
    fn draw_box_tile_leaves_outside_pixels_untouched() {
        let green = Rgba::rgb(0x20, 0x60, 0x20);
        let mut fb = FrameBuffer::new(RenderConfig::new(16, 16), green);
        draw_box_tile(
            &box_tiles::TOP_LEFT,
            &box_tiles::outside::TOP_LEFT,
            0,
            0,
            Rgba::BLACK,
            Rgba::WHITE,
            &mut fb,
        );
        // (0,0) is outside the rounded corner arc: untouched.
        assert_eq!(fb.get_pixel(0, 0), Some(green));
        // (4,1) is on the stroke: ink.
        assert_eq!(fb.get_pixel(4, 1), Some(Rgba::BLACK));
        // (7,7) is interior: background fill.
        assert_eq!(fb.get_pixel(7, 7), Some(Rgba::WHITE));
    }

    #[test]
    fn full_cjk_repertoire_baked() {
        // Characters absent from the old hand-picked subset — guards against the
        // build regressing to a curated list. (陈 is why the wuxia protagonist 陈墨
        // had to be abbreviated to 墨 before the full repertoire was baked.)
        for ch in "陈剑江湖金土星令传奇侠君臣岂".chars() {
            assert!(
                lookup_glyph(ch).is_some(),
                "CJK glyph {ch:?} should be baked"
            );
            assert!(
                is_cjk(ch),
                "{ch:?} should be full-width CJK (advance >= 10)"
            );
        }
        // Full-width CJK punctuation is in the set too.
        for ch in "：，。！？「」、".chars() {
            assert!(
                lookup_glyph(ch).is_some(),
                "punctuation {ch:?} should be baked"
            );
        }
        // The blob carries full GB/CJK coverage, not a few hundred glyphs.
        assert!(
            blob_u32(0) > 20_000,
            "expected full CJK repertoire, got {} glyphs",
            blob_u32(0)
        );
    }
}
