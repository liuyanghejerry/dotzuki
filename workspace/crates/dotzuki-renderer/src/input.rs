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
}

impl GbButton {
    pub const ALL: [GbButton; 8] = [
        GbButton::A,
        GbButton::B,
        GbButton::Select,
        GbButton::Start,
        GbButton::Right,
        GbButton::Left,
        GbButton::Up,
        GbButton::Down,
    ];

    pub fn bit_mask(self) -> u8 {
        1 << (self as u8)
    }
}

#[derive(Debug, Clone)]
pub struct InputState {
    current: u8,
    previous: u8,
}

impl InputState {
    pub fn new() -> Self {
        Self {
            current: 0,
            previous: 0,
        }
    }

    pub fn is_held(&self, button: GbButton) -> bool {
        self.current & button.bit_mask() != 0
    }

    pub fn is_just_pressed(&self, button: GbButton) -> bool {
        let mask = button.bit_mask();
        (self.current & mask != 0) && (self.previous & mask == 0)
    }

    pub fn is_just_released(&self, button: GbButton) -> bool {
        let mask = button.bit_mask();
        (self.current & mask == 0) && (self.previous & mask != 0)
    }

    pub fn any_held(&self) -> bool {
        self.current != 0
    }

    pub fn any_just_pressed(&self) -> bool {
        (self.current & !self.previous) != 0
    }

    pub fn raw_current(&self) -> u8 {
        self.current
    }

    pub fn raw_previous(&self) -> u8 {
        self.previous
    }

    pub fn begin_frame(&mut self) {
        self.previous = self.current;
    }

    pub fn press(&mut self, button: GbButton) {
        self.current |= button.bit_mask();
    }

    pub fn release(&mut self, button: GbButton) {
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
    }

    pub fn set_from_bitmask(&mut self, mask: u8) {
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
        _ => None,
    }
}

/// Accumulates button events between simulation frames. A press followed by a
/// release before the next frame is exposed as a one-frame press. Multiple taps
/// between frames coalesce; held keys do not generate repeated press edges.
#[derive(Debug, Clone, Default)]
pub struct BufferedInput {
    held: u8,
    pending: u8,
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
}
