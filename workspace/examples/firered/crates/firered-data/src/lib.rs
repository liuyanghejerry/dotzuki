//! FireRed/LeafGreen color palette data for GBA-style rendering.
//!
//! This crate provides GBA-style 16-color palettes that demonstrate
//! the color rendering capabilities of the jrpg-engine framework.
//! Unlike the pokered example which uses 4-shade DMG palettes,
//! this crate defines full 16-color palettes for backgrounds,
//! sprites, and UI elements.

pub mod firered_map;
pub mod palettes;

pub use firered_map::{
    FireRedMap, LayerType, Metatile, TileEntry, MAP_H, MAP_W, METATILE, NUM_PALETTES,
    PLAYER_FRAME_H, PLAYER_FRAME_W, PLAYER_FRAMES, TILE,
};

use jrpg_engine::palette::PaletteTrait;

pub use jrpg_renderer::palette::GbaColor;
pub type GbaPalette = jrpg_renderer::palette::Palette<GbaColor>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[repr(u8)]
pub enum FireRedPaletteId {
    /// Overworld - grassy routes and fields
    Overworld = 0,
    /// Town - Viridian/Pewter-like towns
    Town = 1,
    /// Forest - darker, lush green tones (Viridian Forest)
    Forest = 2,
    /// Cave - dark, rocky tones (Mt. Moon)
    Cave = 3,
    /// Water - ocean and river routes
    Water = 4,
    /// Building interior - warm indoor tones
    Indoor = 5,
    /// Title screen - FireRed's fiery red/orange theme
    TitleScreen = 6,
    /// Battle background - default battle scene
    Battle = 7,
    /// UI - menu and dialog colors
    UI = 8,
    /// Player sprite palette
    Player = 9,
    /// NPC sprite palette
    NPC = 10,
}

impl PaletteTrait for FireRedPaletteId {}

impl FireRedPaletteId {
    /// Total number of palette IDs.
    pub const COUNT: usize = 11;

    /// Convert from a u8 value, returning None if out of range.
    pub fn from_u8(val: u8) -> Option<Self> {
        use FireRedPaletteId::*;
        match val {
            0 => Some(Overworld),
            1 => Some(Town),
            2 => Some(Forest),
            3 => Some(Cave),
            4 => Some(Water),
            5 => Some(Indoor),
            6 => Some(TitleScreen),
            7 => Some(Battle),
            8 => Some(UI),
            9 => Some(Player),
            10 => Some(NPC),
            _ => None,
        }
    }

    /// Convert to u8.
    pub fn as_u8(self) -> u8 {
        self as u8
    }

    /// Get the display name for this palette.
    pub fn name(&self) -> &'static str {
        use FireRedPaletteId::*;
        match self {
            Overworld => "Overworld",
            Town => "Town",
            Forest => "Forest",
            Cave => "Cave",
            Water => "Water",
            Indoor => "Indoor",
            TitleScreen => "Title Screen",
            Battle => "Battle",
            UI => "UI",
            Player => "Player",
            NPC => "NPC",
        }
    }
}

// ============================================================================
// Color constants for UI elements
// ============================================================================

/// FireRed UI colors — used for menus, dialogs, text boxes.
pub mod ui_colors {
    use jrpg_engine::render::Rgba;

    pub const TEXT_WHITE: Rgba = Rgba::rgb(0xF8, 0xF8, 0xF8);
    pub const TEXT_LIGHT: Rgba = Rgba::rgb(0xC0, 0xC8, 0xD0);
    pub const TEXT_DARK: Rgba = Rgba::rgb(0x50, 0x50, 0x60);
    pub const TEXT_BLACK: Rgba = Rgba::rgb(0x10, 0x10, 0x18);

    pub const DIALOG_BG: Rgba = Rgba::rgb(0x38, 0x40, 0x50);
    pub const DIALOG_BORDER: Rgba = Rgba::rgb(0x60, 0x68, 0x78);
    pub const DIALOG_SHADOW: Rgba = Rgba::rgb(0x18, 0x20, 0x28);

    pub const MENU_BG: Rgba = Rgba::rgb(0x40, 0x48, 0x58);
    pub const MENU_HIGHLIGHT: Rgba = Rgba::rgb(0xE0, 0x68, 0x30);
    pub const MENU_SELECTED: Rgba = Rgba::rgb(0xF8, 0x88, 0x48);

    pub const HP_GREEN: Rgba = Rgba::rgb(0x30, 0xD8, 0x30);
    pub const HP_YELLOW: Rgba = Rgba::rgb(0xF8, 0xC0, 0x30);
    pub const HP_RED: Rgba = Rgba::rgb(0xF8, 0x30, 0x30);
    pub const HP_BG: Rgba = Rgba::rgb(0x38, 0x60, 0x30);

    pub const EXP_BLUE: Rgba = Rgba::rgb(0x40, 0x80, 0xF8);
    pub const EXP_BG: Rgba = Rgba::rgb(0x20, 0x40, 0x80);
}

// ============================================================================
// Render configuration
// ============================================================================

/// GBA screen dimensions for FireRed rendering.
pub const GBA_SCREEN_WIDTH: u32 = 240;
pub const GBA_SCREEN_HEIGHT: u32 = 160;
pub const GBA_TILE_SIZE: u32 = 8;
pub const GBA_SCREEN_TILES_X: u32 = GBA_SCREEN_WIDTH / GBA_TILE_SIZE; // 30
pub const GBA_SCREEN_TILES_Y: u32 = GBA_SCREEN_HEIGHT / GBA_TILE_SIZE; // 20
