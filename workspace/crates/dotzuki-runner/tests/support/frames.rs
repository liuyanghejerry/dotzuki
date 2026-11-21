use dotzuki_engine::render::{DirtyRegion, FrameBuffer, Rgba};
use dotzuki_engine::render_config::RenderConfig;
use dotzuki_runner::{RunnerGame, SCREEN_H, SCREEN_W};

pub struct Frames {
    retained: FrameBuffer,
    reference: FrameBuffer,
}

impl Frames {
    pub fn new() -> Self {
        let retained = FrameBuffer::new(
            RenderConfig::new(SCREEN_W as u32, SCREEN_H as u32),
            Rgba::BLACK,
        );
        Self {
            reference: retained.clone(),
            retained,
        }
    }

    pub fn check(&mut self, game: &mut RunnerGame) -> DirtyRegion {
        let damage = game.draw_retained(&mut self.retained);
        game.draw(&mut self.reference);
        assert_eq!(
            self.retained
                .data
                .iter()
                .zip(&self.reference.data)
                .position(|(a, b)| a != b),
            None,
            "retained pixel mismatch, damage {damage:?}"
        );
        damage
    }
}
