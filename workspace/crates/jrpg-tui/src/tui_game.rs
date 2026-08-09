use jrpg_renderer::FrameBuffer;

use crate::input::InputState;

/// A game that can be driven by the jrpg-tui loop.
pub trait TuiGame {
    /// The button type used for input.
    type Button: Copy + PartialEq;

    /// Called once per frame. Process input before returning.
    fn update(&mut self, input: &InputState<Self::Button>);

    /// Called once per frame. Draw the current screen into the framebuffer.
    fn draw(&mut self, fb: &mut FrameBuffer);

    /// Should the loop exit?
    fn exit_requested(&self) -> bool;
}
