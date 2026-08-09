use std::fmt::Debug;
use std::hash::Hash;

// ============================================================================
// SGB Color Types (shared between engine, data, and renderer)
// ============================================================================

/// A single SGB color in 5-bit-per-channel RGB format.
/// Stored as the original 5-bit values (0-31 per channel).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SgbColor {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

impl SgbColor {
    pub const fn new(r: u8, g: u8, b: u8) -> Self {
        Self { r, g, b }
    }
}

/// An SGB palette entry: 4 colors (color0..color3).
/// color0 is typically the lightest, color3 the darkest.
pub type SgbPaletteEntry = [SgbColor; 4];

/// SGB palette IDs — indexes into SuperPalettes.
/// These correspond to PAL_* constants from the Game Boy game.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[repr(u8)]
pub enum SgbPaletteId {
    Route = 0x00,
    Pallet = 0x01,
    Viridian = 0x02,
    Pewter = 0x03,
    Cerulean = 0x04,
    Lavender = 0x05,
    Vermilion = 0x06,
    Celadon = 0x07,
    Fuchsia = 0x08,
    Cinnabar = 0x09,
    Indigo = 0x0A,
    Saffron = 0x0B,
    TownMap = 0x0C,
    Logo1 = 0x0D,
    Logo2 = 0x0E,
    Pal0F = 0x0F,
    MewMon = 0x10,
    BlueMon = 0x11,
    RedMon = 0x12,
    CyanMon = 0x13,
    PurpleMon = 0x14,
    BrownMon = 0x15,
    GreenMon = 0x16,
    PinkMon = 0x17,
    YellowMon = 0x18,
    GrayMon = 0x19,
    Slots1 = 0x1A,
    Slots2 = 0x1B,
    Slots3 = 0x1C,
    Slots4 = 0x1D,
    Black = 0x1E,
    GreenBar = 0x1F,
    YellowBar = 0x20,
    RedBar = 0x21,
    Badge = 0x22,
    Cave = 0x23,
    GameFreak = 0x24,
}

/// Total number of SGB palettes (NUM_SGB_PALS = 0x25 = 37).
pub const NUM_SGB_PALS: usize = 0x25;

impl SgbPaletteId {
    pub fn from_u8(val: u8) -> Option<Self> {
        if val < NUM_SGB_PALS as u8 {
            Some(unsafe { core::mem::transmute(val) })
        } else {
            None
        }
    }

    pub fn as_u8(self) -> u8 {
        self as u8
    }
}

/// Palette command IDs dispatched during palette transitions.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum SetPalCommand {
    BattleBlack = 0x00,
    Battle = 0x01,
    TownMap = 0x02,
    StatusScreen = 0x03,
    Pokedex = 0x04,
    Slots = 0x05,
    TitleScreen = 0x06,
    NidorinoIntro = 0x07,
    Generic = 0x08,
    Overworld = 0x09,
    PartyMenu = 0x0A,
    PokemonWholeScreen = 0x0B,
    GameFreakIntro = 0x0C,
    TrainerCard = 0x0D,
}

/// Special command: update HP bar colors in party menu BLK packet.
pub const SET_PAL_PARTY_MENU_HP_BARS: u8 = 0xFC;
/// Special command: use wDefaultPaletteCommand instead.
pub const SET_PAL_DEFAULT: u8 = 0xFF;

impl SetPalCommand {
    pub fn from_u8(val: u8) -> Option<Self> {
        match val {
            0x00 => Some(Self::BattleBlack),
            0x01 => Some(Self::Battle),
            0x02 => Some(Self::TownMap),
            0x03 => Some(Self::StatusScreen),
            0x04 => Some(Self::Pokedex),
            0x05 => Some(Self::Slots),
            0x06 => Some(Self::TitleScreen),
            0x07 => Some(Self::NidorinoIntro),
            0x08 => Some(Self::Generic),
            0x09 => Some(Self::Overworld),
            0x0A => Some(Self::PartyMenu),
            0x0B => Some(Self::PokemonWholeScreen),
            0x0C => Some(Self::GameFreakIntro),
            0x0D => Some(Self::TrainerCard),
            _ => None,
        }
    }

    pub fn as_u8(self) -> u8 {
        self as u8
    }
}

// ============================================================================
// Palette Trait & Provider
// ============================================================================

/// Marker trait for palette identifiers.
///
/// Implementations are typically lightweight enums or numeric IDs
/// that uniquely identify a colour palette used for rendering
/// backgrounds, sprites, or UI elements.
pub trait PaletteTrait: Copy + Eq + Hash + Debug + 'static {}

impl PaletteTrait for SgbPaletteId {}

/// Provider trait that supplies palette data to the engine.
///
/// The renderer queries this provider to obtain the correct colour
/// palette for the current scene, overworld map, or Pokémon sprite.
pub trait PaletteProvider<P: PaletteTrait> {
    /// Returns the 4-colour background palette as an array of colour indices.
    fn bg_palette(&self, palette: P) -> [u8; 4];

    /// Returns the first 4-colour object (sprite) palette.
    fn obj_palette0(&self, palette: P) -> [u8; 4];

    /// Returns the second 4-colour object (sprite) palette.
    fn obj_palette1(&self, palette: P) -> [u8; 4];

    /// Returns the overworld palette for a given tileset and map combination.
    ///
    /// The `last_map` parameter is used for palette transition smoothing
    /// when the player moves between maps with different palettes.
    fn overworld_palette_for(&self, tileset_id: u8, map_id: u8, last_map: u8) -> P;

    /// Returns the palette used to colour a monster/Pokémon sprite.
    fn monster_palette(&self, species_index: u8) -> P;

    /// Look up the SGB palette entry (4 SGB colors) for the given palette ID.
    ///
    /// Used by SGB rendering mode to convert palette IDs to actual colors.
    /// Default returns a black fallback.
    fn sgb_palette_data(&self, _id: P, _is_red: bool) -> SgbPaletteEntry {
        [SgbColor::new(0, 0, 0); 4]
    }

    /// Convert HP bar color index (0=green, 1=yellow, 2=red) to a palette ID.
    fn hp_bar_to_palette_id(&self, hp_bar_color: u8) -> P;
}
