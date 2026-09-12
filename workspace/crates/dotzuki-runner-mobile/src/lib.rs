//! The zero-Rust project adapter for the shared mobile host.
use dotzuki_engine::render::{FrameBuffer, Rgba};
use dotzuki_engine::render_config::RenderConfig;
use dotzuki_mobile::{MobileGame, MobileRuntime};
pub use dotzuki_mobile::{ABI_VERSION, AUDIO_SAMPLE_RATE};
use dotzuki_renderer::input::InputState;
use dotzuki_runner::{
    LoadedProject, PackFiles, ProjectFiles, RunnerGame, RunnerOptions, SCREEN_H, SCREEN_W,
};
use std::sync::Arc;
pub struct MobileRunner;
impl MobileRunner {
    pub fn from_pack(pack: Vec<u8>, save_json: Option<&str>) -> Result<MobileRuntime, String> {
        let files: Arc<dyn ProjectFiles> =
            Arc::new(PackFiles::from_bytes(pack).map_err(|e| format!("invalid game pack: {e:#}"))?);
        let project = LoadedProject::load_with_files(files)
            .map_err(|e| format!("project load failed: {e:#}"))?;
        let mut game = RunnerGame::new(
            project,
            RunnerOptions {
                watch: false,
                headless: true,
                pcm_audio: true,
                fresh: true,
                write_saves: false,
                external_saves: true,
                ..RunnerOptions::default()
            },
        )
        .map_err(|e| format!("game boot failed: {e:#}"))?;
        if let Some(save) = save_json {
            if !game.import_save(save) {
                return Err("invalid game save".into());
            }
        }
        MobileRuntime::new(RunnerAdapter {
            game,
            input: InputState::new(),
            frame: FrameBuffer::new(
                RenderConfig::new(SCREEN_W as u32, SCREEN_H as u32),
                Rgba::BLACK,
            ),
        })
    }
}
struct RunnerAdapter {
    game: RunnerGame,
    input: InputState,
    frame: FrameBuffer,
}
impl MobileGame for RunnerAdapter {
    fn dimensions(&self) -> (u32, u32) {
        (SCREEN_W as u32, SCREEN_H as u32)
    }
    fn tick(&mut self, bits: u8) {
        self.input.set_from_bitmask(bits);
        self.game.update(&self.input);
        self.input.begin_frame();
        self.game.draw(&mut self.frame);
    }
    fn copy_rgba(&self, out: &mut [u8]) {
        out.copy_from_slice(&self.frame.data);
    }
    fn render_audio(&mut self, out: &mut [f32]) {
        let pcm = self.game.render_audio(out.len() / 2);
        out.fill(0.0);
        let n = out.len().min(pcm.len());
        out[..n].copy_from_slice(&pcm[..n]);
    }
    fn export_save(&self) -> Option<String> {
        self.game.export_save()
    }
    fn import_save(&mut self, json: &str) -> bool {
        self.game.import_save(json)
    }
}
dotzuki_mobile::export_mobile_abi!(MobileRunner::from_pack);
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ffi_rejects_empty_pack_and_reports_error() {
        let runner = unsafe { dotzuki_mobile_create(std::ptr::null(), 0, std::ptr::null(), 0) };
        assert!(runner.is_null());
        let len = unsafe { dotzuki_mobile_last_error(std::ptr::null_mut(), 0) };
        let mut message = vec![0; len];
        unsafe { dotzuki_mobile_last_error(message.as_mut_ptr(), message.len()) };
        assert!(String::from_utf8_lossy(&message).contains("null or empty"));
    }

    #[test]
    fn abi_is_versioned() {
        assert_eq!(dotzuki_mobile_abi_version(), 1);
    }
}
