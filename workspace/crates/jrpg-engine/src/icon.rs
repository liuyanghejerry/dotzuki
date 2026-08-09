/// Icon kind used by party / status menus.
///
/// Categorizes the visual type of monster/character icons displayed
/// in UI elements such as the party screen.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[repr(u8)]
pub enum IconKind {
    /// Generic biped monster (default)
    Mon = 0,
    /// Ball-shaped icon (Magnemite, Voltorb, …)
    Ball = 1,
    /// Spiral / shell-fossil icon (Shellder, Omanyte, …)
    Helix = 2,
    /// Round fairy-type icon (Pikachu, Clefairy, …)
    Fairy = 3,
    /// Bird icon (Pidgey, Articuno, …)
    Bird = 4,
    /// Aquatic icon (Squirtle, Magikarp, …)
    Water = 5,
    /// Bug icon (Caterpie, Scyther, …)
    Bug = 6,
    /// Plant / grass icon (Bulbasaur, Oddish, …)
    Grass = 7,
    /// Snake icon (Ekans, Onix, Dratini, …)
    Snake = 8,
    /// Quadruped icon (Rattata, Vulpix, …)
    Quadruped = 9,
}
