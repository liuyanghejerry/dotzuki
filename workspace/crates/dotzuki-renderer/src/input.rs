//! Shared button snapshots and host event buffering.
//!
//! Masks use `u16`: the original eight buttons occupy bits 0–7, followed by
//! R and L at bits 8–9. Eight-bit host ABIs can zero-extend their existing masks.
//!
//! ```
//! use dotzuki_renderer::input::{GbButton, InputState};
//! let legacy_mask: u8 = 1;
//! let mut input = InputState::new();
//! input.set_from_bitmask(u16::from(legacy_mask) | GbButton::L.bit_mask());
//! assert!(input.is_just_pressed(GbButton::A));
//! assert!(input.is_held(GbButton::L));
//! input.begin_frame();
//! assert!(!input.any_just_pressed());
//! ```

#[cfg(feature = "gpu")]
use winit::keyboard::KeyCode;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[repr(u8)]
pub enum GbButton {
    A = 0,
    B = 1,
    Select = 2,
    Start = 3,
    Right = 4,
    Left = 5,
    Up = 6,
    Down = 7,
    R = 8,
    L = 9,
}

impl GbButton {
    pub const ALL: [GbButton; 10] = [
        GbButton::A,
        GbButton::B,
        GbButton::Select,
        GbButton::Start,
        GbButton::Right,
        GbButton::Left,
        GbButton::Up,
        GbButton::Down,
        GbButton::R,
        GbButton::L,
    ];

    pub fn bit_mask(self) -> u16 {
        1 << (self as u8)
    }
}

#[derive(Debug, Clone)]
pub struct InputState {
    current: u16,
    previous: u16,
    pressed: Option<u16>,
}

impl InputState {
    pub fn new() -> Self {
        Self {
            current: 0,
            previous: 0,
            pressed: None,
        }
    }

    /// Construct a frame whose press edges are independent of its held state.
    /// Consumers can expose an exact event channel without changing either
    /// current or previous held buttons. Physical mutations and `begin_frame`
    /// discard the explicit channel and resume ordinary edge derivation.
    pub fn from_explicit_channels(current: u16, previous: u16, pressed: u16) -> Self {
        Self {
            current,
            previous,
            pressed: Some(pressed),
        }
    }

    /// Buttons pressed this frame, using an explicit channel when supplied.
    pub fn pressed_mask(&self) -> u16 {
        self.pressed.unwrap_or(self.current & !self.previous)
    }

    pub fn is_held(&self, button: GbButton) -> bool {
        self.current & button.bit_mask() != 0
    }

    pub fn is_just_pressed(&self, button: GbButton) -> bool {
        self.pressed_mask() & button.bit_mask() != 0
    }

    pub fn is_just_released(&self, button: GbButton) -> bool {
        let mask = button.bit_mask();
        (self.current & mask == 0) && (self.previous & mask != 0)
    }

    pub fn any_held(&self) -> bool {
        self.current != 0
    }

    pub fn any_just_pressed(&self) -> bool {
        self.pressed_mask() != 0
    }

    pub fn raw_current(&self) -> u16 {
        self.current
    }

    pub fn raw_previous(&self) -> u16 {
        self.previous
    }

    pub fn begin_frame(&mut self) {
        self.previous = self.current;
        self.pressed = None;
    }

    pub fn press(&mut self, button: GbButton) {
        self.pressed = None;
        self.current |= button.bit_mask();
    }

    pub fn release(&mut self, button: GbButton) {
        self.pressed = None;
        self.current &= !button.bit_mask();
    }

    #[cfg(feature = "gpu")]
    pub fn set_from_keycode(&mut self, keycode: KeyCode, pressed: bool) {
        if let Some(button) = keycode_to_gb_button(keycode) {
            if pressed {
                self.press(button);
            } else {
                self.release(button);
            }
        }
    }

    pub fn clear(&mut self) {
        self.current = 0;
        self.previous = 0;
        self.pressed = None;
    }

    pub fn set_from_bitmask(&mut self, mask: u16) {
        self.pressed = None;
        self.current = mask;
    }
}

impl Default for InputState {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(feature = "gpu")]
pub fn keycode_to_gb_button(keycode: KeyCode) -> Option<GbButton> {
    match keycode {
        // Arrow keys / WASD → D-pad
        KeyCode::ArrowUp | KeyCode::KeyW => Some(GbButton::Up),
        KeyCode::ArrowDown | KeyCode::KeyS => Some(GbButton::Down),
        KeyCode::ArrowLeft | KeyCode::KeyA => Some(GbButton::Left),
        KeyCode::ArrowRight | KeyCode::KeyD => Some(GbButton::Right),
        // Z → A button, X → B button
        KeyCode::KeyZ => Some(GbButton::A),
        KeyCode::KeyX => Some(GbButton::B),
        // Enter/Space → Start, Backspace/RightShift → Select
        KeyCode::Enter | KeyCode::Space => Some(GbButton::Start),
        KeyCode::Backspace | KeyCode::ShiftRight => Some(GbButton::Select),
        // Q/E → left/right shoulder buttons
        KeyCode::KeyQ => Some(GbButton::L),
        KeyCode::KeyE => Some(GbButton::R),
        _ => None,
    }
}

/// Accumulates button events between simulation frames. A press followed by a
/// release before the next frame is exposed as a one-frame press. Multiple taps
/// between frames coalesce; held keys do not generate repeated press edges.
#[derive(Debug, Clone, Default)]
pub struct BufferedInput {
    held: u16,
    pending: u16,
    frame: InputState,
}

impl BufferedInput {
    /// Record a button transition. Repeated key-down events are ignored.
    pub fn set_button(&mut self, button: GbButton, pressed: bool) {
        let bit = button.bit_mask();
        if pressed {
            self.pending |= bit & !self.held;
            self.held |= bit;
        } else {
            self.held &= !bit;
        }
    }

    /// Produce input for one simulation update and consume pending presses.
    pub fn next_frame(&mut self) -> InputState {
        self.frame.begin_frame();
        self.frame.set_from_bitmask(self.held | self.pending);
        self.pending = 0;
        self.frame.clone()
    }

    /// Forget held buttons, pending taps and edge history (for focus loss).
    pub fn clear(&mut self) {
        *self = Self::default();
    }

    /// Record a physical key using the renderer's standard button mapping.
    #[cfg(feature = "gpu")]
    pub fn set_from_keycode(&mut self, keycode: KeyCode, pressed: bool) {
        if let Some(button) = keycode_to_gb_button(keycode) {
            self.set_button(button, pressed);
        }
    }
}

#[cfg(test)]
mod buffered_tests {
    use super::*;

    #[test]
    fn ten_button_masks_preserve_the_original_eight_bit_assignments() {
        let expected = [
            (GbButton::A, 0x001),
            (GbButton::B, 0x002),
            (GbButton::Select, 0x004),
            (GbButton::Start, 0x008),
            (GbButton::Right, 0x010),
            (GbButton::Left, 0x020),
            (GbButton::Up, 0x040),
            (GbButton::Down, 0x080),
            (GbButton::R, 0x100),
            (GbButton::L, 0x200),
        ];
        assert_eq!(GbButton::ALL, expected.map(|(button, _)| button));
        for (button, mask) in expected {
            assert_eq!(button.bit_mask(), mask);
        }
    }

    #[test]
    fn all_ten_bit_combinations_keep_held_press_and_release_channels() {
        for mask in 0u16..=0x3ff {
            let mut input = InputState::new();
            input.set_from_bitmask(mask);
            assert_eq!(input.raw_current(), mask);
            assert_eq!(input.raw_previous(), 0);
            assert_eq!(input.pressed_mask(), mask);
            for button in GbButton::ALL {
                let held = mask & button.bit_mask() != 0;
                assert_eq!(input.is_held(button), held);
                assert_eq!(input.is_just_pressed(button), held);
                assert!(!input.is_just_released(button));
            }
            input.begin_frame();
            assert_eq!(input.raw_previous(), mask);
            assert_eq!(input.pressed_mask(), 0);
            input.set_from_bitmask(0);
            for button in GbButton::ALL {
                assert_eq!(
                    input.is_just_released(button),
                    mask & button.bit_mask() != 0
                );
            }
        }
    }

    #[test]
    fn simultaneous_quick_taps_preserve_both_shoulder_bits_for_one_update() {
        let mut input = BufferedInput::default();
        for button in GbButton::ALL {
            input.set_button(button, true);
            input.set_button(button, false);
        }
        let tapped = input.next_frame();
        assert_eq!(tapped.raw_current(), 0x3ff);
        assert_eq!(tapped.pressed_mask(), 0x3ff);
        let released = input.next_frame();
        assert_eq!(released.raw_current(), 0);
        assert_eq!(released.raw_previous(), 0x3ff);
        for button in GbButton::ALL {
            assert!(released.is_just_released(button));
        }
        assert_eq!(input.next_frame().raw_previous(), 0);
    }

    #[test]
    fn explicit_press_edges_do_not_modify_held_or_previous_channels() {
        let a = GbButton::A.bit_mask();
        let l = GbButton::L.bit_mask();
        let mut same_held = InputState::from_explicit_channels(a, a, a | l);
        assert_eq!(same_held.raw_current(), a);
        assert_eq!(same_held.raw_previous(), a);
        assert!(same_held.is_held(GbButton::A));
        assert!(!same_held.is_held(GbButton::L));
        assert!(same_held.is_just_pressed(GbButton::A));
        assert!(same_held.is_just_pressed(GbButton::L));
        assert!(same_held.any_just_pressed());
        same_held.begin_frame();
        assert_eq!(same_held.raw_current(), a);
        assert_eq!(same_held.raw_previous(), a);
        assert_eq!(same_held.pressed_mask(), 0);

        let suppressed = InputState::from_explicit_channels(a, 0, 0);
        assert!(suppressed.any_held());
        assert!(!suppressed.any_just_pressed());
        assert!(!suppressed.is_just_pressed(GbButton::A));
    }

    #[test]
    fn physical_mutations_discard_an_explicit_press_channel() {
        let l = GbButton::L.bit_mask();
        let r = GbButton::R.bit_mask();
        let explicit = InputState::from_explicit_channels(l, l, GbButton::A.bit_mask());
        let mut pressed = explicit.clone();
        pressed.press(GbButton::R);
        assert_eq!(pressed.pressed_mask(), r);
        let mut released = explicit.clone();
        released.release(GbButton::L);
        assert_eq!(released.pressed_mask(), 0);
        assert!(released.is_just_released(GbButton::L));
        let mut replaced = explicit.clone();
        replaced.set_from_bitmask(r);
        assert_eq!(replaced.pressed_mask(), r);
        let mut cleared = explicit;
        cleared.clear();
        assert_eq!(cleared.raw_current(), 0);
        assert_eq!(cleared.raw_previous(), 0);
        assert_eq!(cleared.pressed_mask(), 0);
    }

    #[cfg(feature = "gpu")]
    #[test]
    fn shared_keyboard_mapping_keeps_existing_keys_and_adds_q_e_shoulders() {
        let expected = [
            (KeyCode::ArrowUp, GbButton::Up),
            (KeyCode::KeyW, GbButton::Up),
            (KeyCode::ArrowDown, GbButton::Down),
            (KeyCode::KeyS, GbButton::Down),
            (KeyCode::ArrowLeft, GbButton::Left),
            (KeyCode::KeyA, GbButton::Left),
            (KeyCode::ArrowRight, GbButton::Right),
            (KeyCode::KeyD, GbButton::Right),
            (KeyCode::KeyZ, GbButton::A),
            (KeyCode::KeyX, GbButton::B),
            (KeyCode::Enter, GbButton::Start),
            (KeyCode::Space, GbButton::Start),
            (KeyCode::Backspace, GbButton::Select),
            (KeyCode::ShiftRight, GbButton::Select),
            (KeyCode::KeyQ, GbButton::L),
            (KeyCode::KeyE, GbButton::R),
        ];
        for (key, button) in expected {
            assert_eq!(keycode_to_gb_button(key), Some(button));
            let mut input = BufferedInput::default();
            input.set_from_keycode(key, true);
            assert!(input.next_frame().is_just_pressed(button));
        }
        assert_eq!(keycode_to_gb_button(KeyCode::Escape), None);
    }

    #[test]
    fn quick_tap_survives_until_one_update() {
        let mut input = BufferedInput::default();
        input.set_button(GbButton::Start, true);
        input.set_button(GbButton::Start, false);
        assert!(input.next_frame().is_just_pressed(GbButton::Start));
        assert!(input.next_frame().is_just_released(GbButton::Start));
        assert!(!input.next_frame().any_held());
    }

    #[test]
    fn holding_and_repeat_do_not_repeat_edges() {
        let mut input = BufferedInput::default();
        input.set_button(GbButton::Right, true);
        assert!(input.next_frame().is_just_pressed(GbButton::Right));
        input.set_button(GbButton::Right, true);
        let frame = input.next_frame();
        assert!(frame.is_held(GbButton::Right));
        assert!(!frame.is_just_pressed(GbButton::Right));
        input.set_button(GbButton::Right, false);
        assert!(input.next_frame().is_just_released(GbButton::Right));
    }

    #[test]
    fn focus_loss_clears_held_and_pending_buttons() {
        let mut input = BufferedInput::default();
        input.set_button(GbButton::Right, true);
        input.next_frame();
        input.set_button(GbButton::A, true);
        input.set_button(GbButton::A, false);
        input.clear();
        assert!(!input.next_frame().any_held());
        input.set_button(GbButton::Right, true);
        assert!(input.next_frame().is_just_pressed(GbButton::Right));
    }

    #[test]
    fn focus_loss_clears_shoulder_history_and_quick_taps_without_release_edges() {
        let mut input = BufferedInput::default();
        input.set_button(GbButton::L, true);
        input.next_frame();
        input.set_button(GbButton::R, true);
        input.set_button(GbButton::R, false);
        input.clear();
        let cleared = input.next_frame();
        assert_eq!(cleared.raw_current(), 0);
        assert_eq!(cleared.raw_previous(), 0);
        assert_eq!(cleared.pressed_mask(), 0);
        assert!(!cleared.is_just_released(GbButton::L));
        input.set_button(GbButton::R, true);
        assert!(input.next_frame().is_just_pressed(GbButton::R));
    }
}
