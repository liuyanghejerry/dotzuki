//! Generic text dialog widget.
//!
//! Renders a bordered text box with word-wrapping and an optional
//! "more text" arrow cursor.  Uses `&[MenuConfig]` — the first config
//! describes the dialog box.
//!
//! All positions are in tile units (8×8 pixels per tile).  The dialog
//! uses the [`Painter`] trait for rendering, making it backend-agnostic.

use dotzuki_engine::menu::MenuConfig;
#[cfg(test)]
use dotzuki_engine::render::TileRect;
use dotzuki_engine::render::{Painter, Rgba, Ui};
use dotzuki_renderer::embedded_font::{char_advance, measure_text};
/// Draw a text dialog box.
///
/// `configs[0]` is the dialog box; extra configs (if any) are ignored.
/// Text is wrapped to fill the box interior, measured with the embedded
/// Fusion Pixel font (Latin 5px, CJK 10px advance — see
/// [`dotzuki_renderer::embedded_font::char_advance`]), showing at most
/// `config.content.th / 2` lines with an optional ▼ arrow.
pub fn draw_dialog<P: Painter>(text: &str, configs: &[MenuConfig], painter: &mut P) {
    let Some(config) = configs.first() else {
        return;
    };
    let mut ui = Ui::new(painter);
    draw_dialog_impl(text, config, &mut ui);
}

/// Draw dialog using a single `MenuConfig` (internal implementation).
fn draw_dialog_impl<P: Painter>(text: &str, config: &MenuConfig, ui: &mut Ui<P>) {
    ui.text_box(config.area, Rgba::INK_BLACK, true, |frame| {
        let rel_tx = config.content.tx.saturating_sub(config.area.tx + 1);
        let rel_ty = config.content.ty.saturating_sub(config.area.ty + 1);
        // Box interior width in pixels (8px tiles). This is the wrap budget
        // for the proportional font — an 18-tile interior fits 144px, i.e.
        // ~28 Latin (5px) or 14 CJK (10px) characters per line.
        let max_width_px = (config.content.tw as usize) * 8;
        let line_height = 2u32;
        let max_lines = (config.content.th / line_height).max(1) as usize;
        let lines = wrap_lines(text, max_width_px, max_lines);

        for (i, line) in lines.iter().enumerate() {
            frame.label(
                rel_tx,
                rel_ty + (i as u32) * line_height,
                line,
                Rgba::INK_BLACK,
            );
        }
        if config.cursor.tile.is_some() && !text.is_empty() {
            let arrow_tx = rel_tx + config.content.tw.saturating_sub(1);
            let arrow_ty = rel_ty + config.content.th.saturating_sub(1);
            frame.cursor_glyph_at(arrow_tx, arrow_ty, '\u{25BC}', Rgba::INK_BLACK);
        }
    });
}

// ── Line wrapping ─────────────────────────────────────────────────

/// Wraps `text` into at most `max_lines` lines, each at most `max_width_px`
/// pixels wide as measured by the embedded Fusion Pixel font (Latin 5px,
/// CJK 10px advance — see [`dotzuki_renderer::embedded_font::char_advance`]).
///
/// Line breaks in the source text are treated as *soft*: the original lines
/// were authored for the 8px GB font, and with the 10px Fusion Pixel font
/// they no longer fill the box, so short lines are merged and re-flowed to
/// fill `max_width_px`. A blank line (`\n\n`) is a hard paragraph break and
/// is preserved as an empty line.
///
/// Text containing CJK ideographs wraps at character boundaries: ASCII words
/// and numbers stay intact, consecutive closing punctuation (……) never
/// splits, and punctuation never dangles at the start or end of a line
/// (禁则处理 — closing punctuation pulls one unit down to the next line, so
/// character order is always preserved). Pure Latin text word-wraps.
pub fn wrap_lines(text: &str, max_width_px: usize, max_lines: usize) -> Vec<String> {
    if max_width_px == 0 || max_lines == 0 {
        return vec![];
    }
    let has_cjk = text.chars().any(is_cjk_char);
    let mut lines: Vec<String> = Vec::new();
    for (para_idx, paragraph) in text.split("\n\n").enumerate() {
        let wrapped = if has_cjk {
            wrap_cjk_paragraph(paragraph, max_width_px)
        } else {
            wrap_latin_paragraph(paragraph, max_width_px)
        };
        for (idx, line) in wrapped.iter().enumerate() {
            // A blank line separates paragraphs in the output.
            if para_idx > 0 && idx == 0 {
                lines.push(String::new());
                if lines.len() >= max_lines {
                    return lines;
                }
            }
            lines.push(line.clone());
            if lines.len() >= max_lines {
                return lines;
            }
        }
    }
    if lines.is_empty() {
        lines.push(String::new());
    }
    lines
}

/// True for CJK ideographs, kana, hangul, full-width forms and CJK
/// punctuation — characters that wrap with full-width (10px) metrics.
fn is_cjk_char(c: char) -> bool {
    matches!(c as u32,
        0x2E80..=0x9FFF   // CJK radicals, punctuation, kana, unified ideographs
        | 0xAC00..=0xD7AF // Hangul syllables
        | 0xF900..=0xFAFF // CJK compatibility ideographs
        | 0xFE30..=0xFE4F // CJK compatibility forms
        | 0xFF00..=0xFFEF // full-width forms
    )
}

/// A single character, an unbreakable ASCII word/number run, or an
/// unbreakable run of closing punctuation (……, ！！) .
#[derive(Debug, Clone)]
enum WrapUnit {
    Ch(char),
    Word(String),
    CloseRun(String),
}

fn unit_width(u: &WrapUnit) -> usize {
    match u {
        WrapUnit::Ch(c) => char_advance(*c) as usize,
        WrapUnit::Word(w) | WrapUnit::CloseRun(w) => measure_text(w) as usize,
    }
}

fn unit_append(out: &mut String, u: &WrapUnit) {
    match u {
        WrapUnit::Ch(c) => out.push(*c),
        WrapUnit::Word(w) | WrapUnit::CloseRun(w) => out.push_str(w),
    }
}

/// Materializes the current line (trimming leading/trailing spaces).
fn units_to_string(units: &[WrapUnit]) -> String {
    let mut s = String::new();
    for u in units {
        unit_append(&mut s, u);
    }
    s.trim().to_string()
}

/// Splits the paragraph into wrap units. `\n` acts as a soft break: between
/// two CJK characters it disappears entirely (CJK needs no inter-word space,
/// mirroring `scripts/reflow_scene_dialogue.py`); otherwise it becomes a
/// space. Consecutive closing punctuation glues into one unbreakable run.
fn cjk_units(paragraph: &str) -> Vec<WrapUnit> {
    let mut units: Vec<WrapUnit> = Vec::new();
    let mut word = String::new();
    let mut chars = paragraph.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\n' || ch == ' ' {
            if !word.is_empty() {
                units.push(WrapUnit::Word(core::mem::take(&mut word)));
            }
            if ch == '\n' {
                let prev_cjk = matches!(units.last(),
                    Some(WrapUnit::Ch(c)) if is_cjk_char(*c))
                    || matches!(units.last(), Some(WrapUnit::CloseRun(_)));
                let next_cjk = chars.peek().is_some_and(|c| is_cjk_char(*c));
                if prev_cjk && next_cjk {
                    continue;
                }
            }
            units.push(WrapUnit::Ch(' '));
        } else if ch.is_ascii_alphanumeric() {
            word.push(ch);
        } else {
            if !word.is_empty() {
                units.push(WrapUnit::Word(core::mem::take(&mut word)));
            }
            if is_closing_punct(ch) {
                match units.last_mut() {
                    Some(WrapUnit::CloseRun(run)) => run.push(ch),
                    _ => units.push(WrapUnit::CloseRun(ch.to_string())),
                }
            } else {
                units.push(WrapUnit::Ch(ch));
            }
        }
    }
    if !word.is_empty() {
        units.push(WrapUnit::Word(word));
    }
    units
}

/// Closing punctuation that must not open a line.
fn is_closing_punct(c: char) -> bool {
    matches!(
        c,
        '，' | '。'
            | '！'
            | '？'
            | '；'
            | '：'
            | '、'
            | '…'
            | '—'
            | '～'
            | '」'
            | '』'
            | '）'
            | '】'
            | '〉'
            | '》'
            | '”'
            | '’'
    )
}

/// Opening brackets that must not end a line.
fn is_opening_punct(c: char) -> bool {
    matches!(c, '「' | '『' | '（' | '【' | '〈' | '《' | '“' | '‘')
}

/// Greedy CJK fill for one paragraph (newlines already softened to spaces).
fn wrap_cjk_paragraph(paragraph: &str, max_width_px: usize) -> Vec<String> {
    let units = cjk_units(paragraph);
    let mut lines: Vec<String> = Vec::new();
    let mut line: Vec<WrapUnit> = Vec::new();
    let mut line_px: usize = 0;

    let mut i = 0;
    while i < units.len() {
        let unit = &units[i];
        let w = unit_width(unit);

        // Never open a line with a space.
        if line.is_empty() && matches!(unit, WrapUnit::Ch(' ')) {
            i += 1;
            continue;
        }

        if line.is_empty() || line_px + w <= max_width_px {
            line.push(unit.clone());
            line_px += w;
            i += 1;
            continue;
        }

        // ── overflow: 禁则处理 (kinsoku shori) ──
        // Closing punctuation must not open a line: pull the last unit of
        // the current line down so the run follows it on the next line
        // (追い込み) — character order is preserved. When the line has only
        // one unit to give, the run overhangs the line end (ぶら下げ) rather
        // than dangling at the start of the next one.
        if let WrapUnit::CloseRun(_) = unit {
            // Drop trailing spaces — they would be trimmed at display anyway.
            while matches!(line.last(), Some(WrapUnit::Ch(' '))) {
                let u = line.pop().unwrap();
                line_px = line_px.saturating_sub(unit_width(&u));
            }
            if line.len() >= 2 {
                let pulled = line.pop().unwrap();
                lines.push(units_to_string(&line));
                line.clear();
                line_px = 0;
                line.push(pulled);
                line_px += unit_width(line.last().unwrap());
                line.push(unit.clone());
                line_px += w;
            } else {
                line.push(unit.clone());
                lines.push(units_to_string(&line));
                line.clear();
                line_px = 0;
            }
            i += 1;
            continue;
        }
        // Opening brackets must not end a line: roll the bracket onto the
        // next line, where it binds to the overflowing unit that follows.
        let mut carried: Option<WrapUnit> = None;
        if let Some(last) = line.last() {
            if matches!(last, WrapUnit::Ch(c) if is_opening_punct(*c)) {
                if let Some(u) = line.pop() {
                    carried = Some(u);
                }
            }
        }
        lines.push(units_to_string(&line));
        line.clear();
        line_px = 0;
        if let Some(u) = carried {
            let uw = unit_width(&u);
            line.push(u);
            line_px += uw;
        }
        // The overflowing unit starts the fresh line (words hard-split).
        match unit {
            WrapUnit::Word(s) => {
                for piece in split_by_pixels(s, max_width_px) {
                    if !line.is_empty() {
                        lines.push(units_to_string(&line));
                        line.clear();
                        line_px = 0;
                    }
                    line.push(WrapUnit::Word(piece));
                    line_px += unit_width(line.last().unwrap());
                }
                i += 1;
            }
            WrapUnit::Ch(' ') => {
                // A space overflowed — drop it rather than open the line with it.
                i += 1;
            }
            WrapUnit::Ch(_) => {
                line.push(unit.clone());
                line_px += w;
                i += 1;
            }
            WrapUnit::CloseRun(_) => unreachable!("closing runs are handled above"),
        }
    }
    if !line.is_empty() {
        lines.push(units_to_string(&line));
    }
    lines
}

/// Latin word wrap for one paragraph (`\n` is whitespace — a soft break).
fn wrap_latin_paragraph(paragraph: &str, max_width_px: usize) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut current_px: usize = 0;

    for token in paragraph.split_whitespace() {
        let token_px = measure_text(token) as usize;
        let space_px = if current.is_empty() {
            0
        } else {
            char_advance(' ') as usize
        };
        if !current.is_empty() && current_px + space_px + token_px > max_width_px {
            lines.push(core::mem::take(&mut current));
            current_px = 0;
        }
        if current.is_empty() {
            if token_px > max_width_px {
                // A single word wider than the line is hard-split by pixels.
                for piece in split_by_pixels(token, max_width_px) {
                    if !current.is_empty() {
                        lines.push(core::mem::take(&mut current));
                    }
                    current = piece;
                    current_px = measure_text(&current) as usize;
                }
            } else {
                current.push_str(token);
                current_px = token_px;
            }
        } else {
            current.push(' ');
            current.push_str(token);
            current_px += space_px + token_px;
        }
    }
    if !current.is_empty() {
        lines.push(current);
    }
    lines
}

/// Splits a word into chunks, each at most `max_width_px` pixels wide.
fn split_by_pixels(s: &str, max_width_px: usize) -> Vec<String> {
    let mut out = Vec::new();
    let mut chunk = String::new();
    let mut chunk_px: usize = 0;
    for ch in s.chars() {
        let w = char_advance(ch) as usize;
        if chunk_px + w > max_width_px && !chunk.is_empty() {
            out.push(core::mem::take(&mut chunk));
            chunk_px = 0;
        }
        chunk.push(ch);
        chunk_px += w;
    }
    if !chunk.is_empty() {
        out.push(chunk);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use dotzuki_engine::render::TilePos;

    #[derive(Debug, Default)]
    struct RecordingPainter {
        text_boxes: Vec<(TileRect, Rgba)>,
        texts: Vec<(TilePos, String, Rgba)>,
        glyphs: Vec<(TilePos, char, Rgba)>,
    }
    impl Painter for RecordingPainter {
        fn clear(&mut self, _: Rgba) {}
        fn draw_text_box(&mut self, rect: TileRect, color: Rgba) {
            self.text_boxes.push((rect, color));
        }
        fn draw_text(&mut self, pos: TilePos, text: &str, color: Rgba) {
            self.texts.push((pos, text.to_string(), color));
        }
        fn draw_glyph(&mut self, pos: TilePos, glyph: char, color: Rgba) {
            self.glyphs.push((pos, glyph, color));
        }
        fn draw_pixel_rect(&mut self, _: u32, _: u32, _: u32, _: u32, _: Rgba) {}
        fn draw_gb_tile(&mut self, _: TilePos, _: u8, _: &str, _: Rgba) {}
    }

    fn dialog_config(show_cursor: bool) -> MenuConfig {
        let area = TileRect::new(0, 14, 20, 4);
        let content = TileRect::new(1, 15, 18, 2);
        let cursor = if show_cursor {
            dotzuki_engine::menu::CursorStyle::new(Some(223), Default::default())
        } else {
            dotzuki_engine::menu::CursorStyle::new(None, Default::default())
        };
        MenuConfig::new(area, None, content, cursor)
    }

    #[test]
    fn wrap_lines_english() {
        // "Hello world test" at 60px: "Hello world" = 55px, adding " test" would be 75px.
        let lines = wrap_lines("Hello world test", 60, 5);
        assert_eq!(lines, vec!["Hello world", "test"]);
        for l in &lines {
            assert!(measure_text(l) as usize <= 60);
        }
    }
    #[test]
    fn wrap_lines_english_fills_line() {
        // 28 Latin chars (28 × 5px = 140px) fit a 144px (18-tile) line —
        // the old 18-char cap only used 90px and left the box half-empty.
        let long = "abcdefghijklmnopqrstuvwxyz12";
        assert_eq!(measure_text(long), 140);
        assert_eq!(wrap_lines(long, 144, 2), vec![long.to_string()]);
    }
    #[test]
    fn wrap_lines_cjk() {
        // 7 full-width chars (70px) in a 30px line → 3 per line.
        let lines = wrap_lines("こんにちは世界", 30, 5);
        assert_eq!(lines, vec!["こんに", "ちは世", "界"]);
        for l in &lines {
            assert!(measure_text(l) as usize <= 30);
        }
    }
    #[test]
    fn wrap_lines_cjk_fills_line() {
        // 14 CJK chars = 140px fill a 144px line (the old cap was 13).
        let long = "一二三四五六七八九十一二三四";
        assert_eq!(measure_text(long), 140);
        assert_eq!(wrap_lines(long, 144, 2), vec![long.to_string()]);
    }
    #[test]
    fn wrap_lines_cjk_keeps_numbers_intact() {
        // "等级10级" — the digits 10 must not be split across lines.
        let lines = wrap_lines("等级10级", 25, 5);
        assert_eq!(lines, vec!["等级", "10级"]);
    }
    #[test]
    fn wrap_lines_cjk_no_leading_closing_punct() {
        // The comma must not open line 2: the last char of line 1 is pulled
        // down so the comma follows it (追い込み) — character order preserved.
        let lines = wrap_lines("你好你好，世界", 40, 5);
        assert_eq!(lines, vec!["你好你", "好，世界"]);
        for l in &lines {
            assert!(measure_text(l) as usize <= 40);
        }
    }
    #[test]
    fn wrap_lines_cjk_preserves_char_order() {
        // Wrapping must only move break positions, never permute characters.
        let text = "我没骗你，我做实验时出了差错，结果和一只宝可梦融合了！";
        let lines = wrap_lines(text, 140, 10);
        assert_eq!(lines.concat(), text);
        assert!(!lines
            .iter()
            .any(|l| l.starts_with('，') || l.starts_with('！')));
    }
    #[test]
    fn wrap_lines_cjk_closing_run_never_splits() {
        // …… is one unbreakable run: it must not be split across lines and
        // must not open a line.
        let lines = wrap_lines("好啊……嗯", 30, 5);
        assert_eq!(lines, vec!["好", "啊……", "嗯"]);
    }
    #[test]
    fn wrap_lines_cjk_soft_newline_between_cjk_drops() {
        // A soft break between two CJK chars disappears (no spurious gap).
        assert_eq!(wrap_lines("你好\n世界", 144, 5), vec!["你好世界"]);
        // …but next to Latin it becomes a space, keeping words apart.
        assert_eq!(wrap_lines("你好\nabc", 144, 5), vec!["你好 abc"]);
    }
    #[test]
    fn wrap_lines_cjk_opening_bracket_not_at_line_end() {
        // 「 must open the next line together with its content, not dangle.
        let lines = wrap_lines("他说「你好", 30, 5);
        assert_eq!(lines, vec!["他说", "「你好"]);
    }
    #[test]
    fn wrap_lines_max_lines() {
        assert!(wrap_lines("one two three four five six seven", 5, 3).len() <= 3);
    }
    #[test]
    fn wrap_lines_newlines() {
        // Single newlines are soft (short authored lines merge to fill);
        // blank lines are hard paragraph breaks.
        let lines = wrap_lines("line1\nline2\nline3", 100, 10);
        assert_eq!(lines, vec!["line1 line2 line3"]);
    }
    #[test]
    fn wrap_lines_blank_line_is_paragraph_break() {
        let lines = wrap_lines("Line one\n\nLine three", 100, 10);
        assert_eq!(lines, vec!["Line one", "", "Line three"]);
    }

    #[test]
    fn draw_dialog_box() {
        let config = dialog_config(true);
        let mut painter = RecordingPainter::default();
        draw_dialog("Hello!", &[config], &mut painter);
        assert_eq!(painter.text_boxes.len(), 1);
        assert_eq!(painter.text_boxes[0].0, TileRect::new(0, 14, 20, 4));
    }
    #[test]
    fn draw_dialog_text() {
        let config = dialog_config(true);
        let mut painter = RecordingPainter::default();
        draw_dialog("Hello!", &[config], &mut painter);
        assert!(painter.texts.iter().any(|(_, t, _)| t == "Hello!"));
    }
    #[test]
    fn draw_dialog_arrow() {
        let config = dialog_config(true);
        let mut painter = RecordingPainter::default();
        draw_dialog("Hi", &[config], &mut painter);
        assert!(!painter.glyphs.is_empty());
    }
    #[test]
    fn draw_dialog_no_arrow() {
        let config = dialog_config(false);
        let mut painter = RecordingPainter::default();
        draw_dialog("Hi", &[config], &mut painter);
        assert!(painter.glyphs.is_empty());
    }
    #[test]
    fn draw_dialog_empty_no_arrow() {
        let config = dialog_config(true);
        let mut painter = RecordingPainter::default();
        draw_dialog("", &[config], &mut painter);
        assert!(painter.glyphs.is_empty());
    }
    #[test]
    fn no_configs() {
        let mut painter = RecordingPainter::default();
        draw_dialog("test", &[], &mut painter);
        assert!(painter.text_boxes.is_empty());
    }
}
