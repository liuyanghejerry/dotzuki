//! Borrowed, build-generated layouts. No JSON parsing or layout allocation at draw time.
//! Authored layouts are lowered by `dotzuki_engine_dsl::static_ui::compile`.
use alloc::{borrow::Cow, string::String};
use dotzuki_engine::render::{Painter, Rgba, TilePos, TileRect};

#[derive(Clone)]
pub enum Value<'a> {
    Text(Cow<'a, str>),
    Int(i64),
    Bool(bool),
}
impl<'a> From<&'a str> for Value<'a> {
    fn from(v: &'a str) -> Self {
        Self::Text(Cow::Borrowed(v))
    }
}
impl From<String> for Value<'_> {
    fn from(v: String) -> Self {
        Self::Text(Cow::Owned(v))
    }
}
impl From<i64> for Value<'_> {
    fn from(v: i64) -> Self {
        Self::Int(v)
    }
}
impl From<bool> for Value<'_> {
    fn from(v: bool) -> Self {
        Self::Bool(v)
    }
}

/// Small stack-owned binding table. Capacity is explicit; overflow is an error.
pub struct Context<'a, const N: usize = 20> {
    values: [Option<(&'static str, Value<'a>)>; N],
}

/// Returned when a static layout context has no free binding slot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ContextCapacityError {
    pub capacity: usize,
}

impl core::fmt::Display for ContextCapacityError {
    fn fmt(&self, formatter: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(
            formatter,
            "static UI context capacity of {} bindings exceeded",
            self.capacity
        )
    }
}
impl<'a, const N: usize> Default for Context<'a, N> {
    fn default() -> Self {
        Self {
            values: core::array::from_fn(|_| None),
        }
    }
}
impl<'a, const N: usize> Context<'a, N> {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn set(
        &mut self,
        key: &'static str,
        value: impl Into<Value<'a>>,
    ) -> Result<(), ContextCapacityError> {
        let slot = self
            .values
            .iter_mut()
            .find(|v| v.as_ref().map_or(true, |(k, _)| *k == key))
            .ok_or(ContextCapacityError { capacity: N })?;
        *slot = Some((key, value.into()));
        Ok(())
    }
    fn get(&self, key: &str) -> Option<&Value<'a>> {
        self.values
            .iter()
            .flatten()
            .find(|(k, _)| *k == key)
            .map(|(_, v)| v)
    }
    fn text(&self, key: &str) -> &str {
        match self.get(key) {
            Some(Value::Text(s)) => s,
            _ => "?",
        }
    }
    fn number(&self, key: &str) -> u32 {
        match self.get(key) {
            Some(Value::Int(n)) => u32::try_from(*n).unwrap_or(0),
            Some(Value::Text(s)) => s.trim().parse().unwrap_or(0),
            _ => 0,
        }
    }
    fn truthy(&self, key: &str) -> bool {
        match self.get(key) {
            Some(Value::Bool(b)) => *b,
            Some(Value::Int(n)) => *n != 0,
            Some(_) => true,
            None => false,
        }
    }
    /// Adapter for editor/runtime layouts; not used by the static draw path.
    pub fn dynamic(&self) -> super::types::DataContext {
        let mut ctx = super::types::DataContext::new();
        for (k, v) in self.values.iter().flatten() {
            match v {
                Value::Text(s) => ctx.set(k, s.as_ref()),
                Value::Int(n) => ctx.set(k, *n),
                Value::Bool(b) => ctx.set(k, *b),
            }
        }
        ctx
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn direct_bindings_match_dynamic_semantics() {
        let values = [
            Value::Int(-1),
            Value::Int(0),
            Value::Int(42),
            Value::Int(i64::MAX),
            Value::Bool(false),
            Value::Bool(true),
            Value::from(" 42 "),
            Value::from(""),
            Value::from("not a number"),
        ];
        for value in values {
            let mut ctx: Context<'_, 1> = Context::new();
            ctx.set("key", value).unwrap();
            let dynamic = ctx.dynamic();
            assert_eq!(
                ctx.number("key"),
                super::super::types::Coord::Template("{key}".into()).resolve(&dynamic)
            );
            assert_eq!(ctx.truthy("key"), dynamic.is_truthy("key"));
            assert_eq!(Text::Binding("key").resolve(&ctx), dynamic.resolve("{key}"));
        }
    }

    #[test]
    fn context_overflow_is_reported_without_panicking() {
        let mut ctx: Context<'_, 1> = Context::new();
        ctx.set("first", 1i64).unwrap();
        assert_eq!(
            ctx.set("second", 2i64),
            Err(ContextCapacityError { capacity: 1 })
        );
        assert!(ctx.set("first", 3i64).is_ok(), "updates reuse their slot");
    }
}

#[derive(Clone, Copy)]
pub enum Coord {
    Literal(u32),
    Binding(&'static str),
}
impl Coord {
    fn resolve<const N: usize>(self, ctx: &Context<'_, N>) -> u32 {
        match self {
            Self::Literal(n) => n,
            Self::Binding(k) => ctx.number(k),
        }
    }
}
#[derive(Clone, Copy)]
pub enum Text {
    Literal(&'static str),
    Binding(&'static str),
    Localized(&'static [(&'static str, Text)]),
}
impl Text {
    fn resolve<'a, const N: usize>(&self, ctx: &'a Context<'_, N>) -> Cow<'a, str> {
        match self {
            Self::Literal(s) => Cow::Borrowed(s),
            Self::Binding(k) => match ctx.get(k) {
                Some(Value::Text(s)) => Cow::Borrowed(s),
                Some(Value::Int(n)) => Cow::Owned(alloc::format!("{n}")),
                Some(Value::Bool(b)) => Cow::Borrowed(if *b { "true" } else { "false" }),
                None => Cow::Borrowed("?"),
            },
            Self::Localized(entries) => entries
                .iter()
                .find(|(k, _)| *k == ctx.text("__lang"))
                .or_else(|| entries.iter().find(|(k, _)| *k == "en"))
                .or_else(|| entries.first())
                .map_or(Cow::Borrowed(""), |(_, text)| text.resolve(ctx)),
        }
    }
}
#[derive(Clone, Copy)]
pub enum Visible {
    Always(bool),
    Binding(&'static str),
}
pub enum Op {
    Border,
    Text {
        value: Text,
        align: super::types::TextAlign,
    },
    Tile {
        id: u8,
        fallback: &'static str,
    },
    Cursor {
        glyph: char,
        col: Coord,
        row: Coord,
        col_step: u32,
        row_step: u32,
    },
}
pub struct Element {
    pub x: Coord,
    pub y: Coord,
    pub width: u32,
    pub height: u32,
    pub visible: Visible,
    pub op: Op,
}
pub struct Layout {
    pub elements: &'static [Element],
}
impl Layout {
    /// Resolve the active cursor from the authored layout, also for damage
    /// tracking and partial cursor redraws. No copied geometry in consumers.
    pub fn cursor<const N: usize>(&self, ctx: &Context<'_, N>) -> Option<(TilePos, char)> {
        self.elements.iter().find_map(|e| {
            let visible = match e.visible {
                Visible::Always(b) => b,
                Visible::Binding(k) => ctx.truthy(k),
            };
            if !visible {
                return None;
            }
            if let Op::Cursor {
                glyph,
                col,
                row,
                col_step,
                row_step,
            } = &e.op
            {
                Some((
                    TilePos::new(
                        e.x.resolve(ctx) + col.resolve(ctx) * col_step,
                        e.y.resolve(ctx) + row.resolve(ctx) * row_step,
                    ),
                    *glyph,
                ))
            } else {
                None
            }
        })
    }
    pub fn render<const N: usize>(
        &self,
        ctx: &Context<'_, N>,
        painter: &mut dyn Painter,
        proportional: bool,
        clear: bool,
    ) {
        if clear {
            painter.clear(Rgba::INK_WHITE);
        }
        for e in self.elements {
            let visible = match e.visible {
                Visible::Always(b) => b,
                Visible::Binding(k) => ctx.truthy(k),
            };
            if !visible {
                continue;
            }
            let x = e.x.resolve(ctx);
            let y = e.y.resolve(ctx);
            match &e.op {
                Op::Border => {
                    painter.draw_text_box(TileRect::new(x, y, e.width, e.height), Rgba::INK_BLACK)
                }
                Op::Text { value, align } => super::elements::text::render_unwrapped_text(
                    &value.resolve(ctx),
                    TileRect::new(x, y, e.width, e.height),
                    align,
                    proportional && painter.supports_proportional(),
                    Rgba::INK_BLACK,
                    1,
                    0,
                    painter,
                ),
                Op::Tile { id, fallback } => {
                    painter.draw_gb_tile(TilePos::new(x, y), *id, fallback, Rgba::INK_BLACK)
                }
                Op::Cursor {
                    glyph,
                    col,
                    row,
                    col_step,
                    row_step,
                } => super::elements::cursor::draw_cursor_glyph(
                    TilePos::new(
                        x + col.resolve(ctx) * col_step,
                        y + row.resolve(ctx) * row_step,
                    ),
                    *glyph,
                    Rgba::INK_BLACK,
                    proportional && painter.supports_proportional(),
                    painter,
                ),
            }
        }
    }
}
