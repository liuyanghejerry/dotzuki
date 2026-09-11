//! Platform-neutral mobile runtime for dotzuki games.
//!
//! The crate mirrors the proven iOS host boundary: a platform owns its
//! window, touch controls, audio device, lifecycle, and save storage while
//! Rust owns [`dotzuki_runner::RunnerGame`]. The exported C ABI uses only
//! opaque pointers, byte buffers, integers, and `f32` PCM, so iOS, Android,
//! and HarmonyOS shells can share one contract.

mod audio_ring;

use std::cell::{RefCell, UnsafeCell};
use std::ffi::CString;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::ptr;
use std::sync::Arc;

use audio_ring::AudioRing;
use dotzuki_engine::render::{FrameBuffer, Rgba};
use dotzuki_engine::render_config::RenderConfig;
use dotzuki_renderer::input::InputState;
use dotzuki_runner::{
    LoadedProject, PackFiles, ProjectFiles, RunnerGame, RunnerOptions, SCREEN_H, SCREEN_W,
};

/// Version of the exported C ABI.
pub const ABI_VERSION: u32 = 1;
/// PCM format delivered by [`MobileRunner::fill_audio`].
pub const AUDIO_SAMPLE_RATE: u32 = 44_100;
const GAME_FRAME_RATE: f64 = 59.7275;

thread_local! {
    static LAST_ERROR: RefCell<CString> = RefCell::new(CString::new("no error").unwrap());
}

fn set_last_error(message: impl AsRef<str>) {
    let cleaned = message.as_ref().replace('\0', " ");
    LAST_ERROR.with(|slot| {
        *slot.borrow_mut() =
            CString::new(cleaned).unwrap_or_else(|_| CString::new("error").unwrap());
    });
}

fn ffi_guard<T>(fallback: T, operation: impl FnOnce() -> T) -> T {
    match catch_unwind(AssertUnwindSafe(operation)) {
        Ok(value) => value,
        Err(_) => {
            set_last_error("Rust runtime panicked while handling a mobile ABI call");
            fallback
        }
    }
}

struct MainState {
    game: RunnerGame,
    input: InputState,
    frame: FrameBuffer,
    audio_fraction: f64,
}

/// Opaque runner shared by the game/display thread and platform audio thread.
///
/// Call [`MobileRunner::tick`] and save methods from one game thread. A single
/// real-time audio callback may call [`MobileRunner::fill_audio`] concurrently.
pub struct MobileRunner {
    main: UnsafeCell<MainState>,
    audio: AudioRing,
}

// `main` remains game-thread-only. `audio` is the only field touched by the
// platform audio thread and supplies its own SPSC synchronization.
unsafe impl Sync for MobileRunner {}

impl MobileRunner {
    /// Boot a zero-Rust project from a `.dzpk` buffer and an optional save.
    pub fn from_pack(pack: Vec<u8>, save_json: Option<&str>) -> Result<Self, String> {
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
            game.import_save(save);
        }
        Ok(Self {
            main: UnsafeCell::new(MainState {
                game,
                input: InputState::new(),
                frame: FrameBuffer::new(
                    RenderConfig::new(SCREEN_W as u32, SCREEN_H as u32),
                    Rgba::BLACK,
                ),
                audio_fraction: 0.0,
            }),
            audio: AudioRing::new(),
        })
    }

    /// Advance and draw one game frame using the common eight-button bitmask.
    ///
    /// The caller must invoke this method from only one game/display thread.
    pub fn tick(&self, input_bits: u8) {
        // SAFETY: the mobile host contract permits one game thread.
        let main = unsafe { &mut *self.main.get() };
        main.input.set_from_bitmask(input_bits);
        main.game.update(&main.input);
        main.input.begin_frame();
        main.game.draw(&mut main.frame);

        main.audio_fraction += AUDIO_SAMPLE_RATE as f64 / GAME_FRAME_RATE;
        let frames = main.audio_fraction.floor() as usize;
        main.audio_fraction -= frames as f64;
        let pcm = main.game.render_audio(frames);
        self.audio.push(&pcm);
    }

    /// Copy the last rendered RGBA frame into `output`.
    pub fn copy_frame(&self, output: &mut [u8]) -> Result<usize, usize> {
        let required = self.frame_len();
        if output.len() < required {
            return Err(required);
        }
        // SAFETY: only the game thread reads or writes `main.frame`.
        let main = unsafe { &*self.main.get() };
        output[..required].copy_from_slice(&main.frame.data);
        Ok(required)
    }

    /// Pull interleaved stereo PCM. Returns stereo frames copied.
    pub fn fill_audio(&self, output: &mut [f32]) -> u32 {
        (self.audio.pop(output) / 2) as u32
    }

    /// Export a stable save as UTF-8 JSON.
    pub fn export_save(&self) -> Option<String> {
        // SAFETY: save operations are game-thread-only.
        unsafe { (&*self.main.get()).game.export_save() }
    }

    /// Restore save JSON without replacing the current state on failure.
    pub fn import_save(&self, json: &str) -> bool {
        // SAFETY: save operations are game-thread-only.
        unsafe { (&mut *self.main.get()).game.import_save(json) }
    }

    pub const fn width(&self) -> u32 {
        SCREEN_W as u32
    }

    pub const fn height(&self) -> u32 {
        SCREEN_H as u32
    }

    pub const fn frame_len(&self) -> usize {
        SCREEN_W as usize * SCREEN_H as usize * 4
    }
}

/// Return [`ABI_VERSION`].
#[no_mangle]
pub extern "C" fn dotzuki_mobile_abi_version() -> u32 {
    ABI_VERSION
}

/// Copy the calling thread's last error as a NUL-terminated UTF-8 string.
///
/// The return value includes the trailing NUL. Passing a null output or a
/// small capacity performs a size query and writes nothing.
#[no_mangle]
pub unsafe extern "C" fn dotzuki_mobile_last_error(output: *mut u8, capacity: usize) -> usize {
    LAST_ERROR.with(|slot| {
        let error = slot.borrow();
        let bytes = error.as_bytes_with_nul();
        if !output.is_null() && capacity >= bytes.len() {
            // SAFETY: the caller promises a writable buffer of `capacity` bytes.
            unsafe { ptr::copy_nonoverlapping(bytes.as_ptr(), output, bytes.len()) };
        }
        bytes.len()
    })
}

/// Create a runner from `.dzpk` bytes and optional UTF-8 save JSON.
#[no_mangle]
pub unsafe extern "C" fn dotzuki_mobile_create(
    pack: *const u8,
    pack_len: usize,
    save: *const u8,
    save_len: usize,
) -> *mut MobileRunner {
    if pack.is_null() || pack_len == 0 {
        set_last_error("game pack is null or empty");
        return ptr::null_mut();
    }
    // SAFETY: validated non-null; caller owns a readable `pack_len` region.
    let pack = unsafe { std::slice::from_raw_parts(pack, pack_len) }.to_vec();
    let save = if save.is_null() {
        None
    } else {
        // SAFETY: caller owns a readable `save_len` region.
        match std::str::from_utf8(unsafe { std::slice::from_raw_parts(save, save_len) }) {
            Ok(value) => Some(value),
            Err(error) => {
                set_last_error(format!("save is not UTF-8: {error}"));
                return ptr::null_mut();
            }
        }
    };
    ffi_guard(ptr::null_mut(), || {
        match MobileRunner::from_pack(pack, save) {
            Ok(runner) => Box::into_raw(Box::new(runner)),
            Err(error) => {
                set_last_error(error);
                ptr::null_mut()
            }
        }
    })
}

/// Destroy a runner. The platform must stop its audio callback first.
#[no_mangle]
pub unsafe extern "C" fn dotzuki_mobile_destroy(runner: *mut MobileRunner) {
    if !runner.is_null() {
        // SAFETY: the pointer came from `dotzuki_mobile_create` and is unique.
        unsafe { drop(Box::from_raw(runner)) };
    }
}

#[no_mangle]
pub unsafe extern "C" fn dotzuki_mobile_width(runner: *const MobileRunner) -> u32 {
    runner.as_ref().map(MobileRunner::width).unwrap_or(0)
}

#[no_mangle]
pub unsafe extern "C" fn dotzuki_mobile_height(runner: *const MobileRunner) -> u32 {
    runner.as_ref().map(MobileRunner::height).unwrap_or(0)
}

#[no_mangle]
pub unsafe extern "C" fn dotzuki_mobile_frame_len(runner: *const MobileRunner) -> usize {
    runner.as_ref().map(MobileRunner::frame_len).unwrap_or(0)
}

/// Advance and render one frame. Returns `false` for a null runner.
#[no_mangle]
pub unsafe extern "C" fn dotzuki_mobile_tick(runner: *mut MobileRunner, input_bits: u8) -> bool {
    let Some(runner) = runner.as_ref() else {
        set_last_error("runner is null");
        return false;
    };
    ffi_guard(false, || {
        runner.tick(input_bits);
        true
    })
}

/// Copy the last RGBA frame. Returns the required byte count, even when the
/// output buffer is null or too small.
#[no_mangle]
pub unsafe extern "C" fn dotzuki_mobile_copy_frame(
    runner: *const MobileRunner,
    output: *mut u8,
    capacity: usize,
) -> usize {
    let Some(runner) = runner.as_ref() else {
        set_last_error("runner is null");
        return 0;
    };
    let required = runner.frame_len();
    if output.is_null() || capacity < required {
        return required;
    }
    ffi_guard(0, || {
        // SAFETY: the caller promises a writable buffer of `capacity` bytes.
        let output = unsafe { std::slice::from_raw_parts_mut(output, capacity) };
        runner.copy_frame(output).unwrap_or(required)
    })
}

/// Pull interleaved stereo `f32` PCM. Returns stereo frames copied.
#[no_mangle]
pub unsafe extern "C" fn dotzuki_mobile_audio_fill(
    runner: *const MobileRunner,
    output: *mut f32,
    frames: u32,
) -> u32 {
    let Some(runner) = runner.as_ref() else {
        return 0;
    };
    if output.is_null() || frames == 0 {
        return 0;
    }
    ffi_guard(0, || {
        let samples = frames as usize * 2;
        // SAFETY: the caller promises a writable interleaved stereo buffer.
        let output = unsafe { std::slice::from_raw_parts_mut(output, samples) };
        runner.fill_audio(output)
    })
}

/// Export UTF-8 save JSON. Returns the required byte count. No bytes are
/// written when the state is transient or the output buffer is too small.
#[no_mangle]
pub unsafe extern "C" fn dotzuki_mobile_export_save(
    runner: *const MobileRunner,
    output: *mut u8,
    capacity: usize,
) -> usize {
    let Some(runner) = runner.as_ref() else {
        return 0;
    };
    ffi_guard(0, || {
        let Some(save) = runner.export_save() else {
            return 0;
        };
        let bytes = save.as_bytes();
        if !output.is_null() && capacity >= bytes.len() {
            // SAFETY: the caller promises a writable buffer of `capacity` bytes.
            unsafe { ptr::copy_nonoverlapping(bytes.as_ptr(), output, bytes.len()) };
        }
        bytes.len()
    })
}

#[no_mangle]
pub unsafe extern "C" fn dotzuki_mobile_import_save(
    runner: *mut MobileRunner,
    save: *const u8,
    save_len: usize,
) -> bool {
    let (Some(runner), false) = (runner.as_ref(), save.is_null()) else {
        set_last_error("runner or save is null");
        return false;
    };
    // SAFETY: the caller promises a readable `save_len` region.
    let bytes = unsafe { std::slice::from_raw_parts(save, save_len) };
    let Ok(json) = std::str::from_utf8(bytes) else {
        set_last_error("save is not UTF-8");
        return false;
    };
    ffi_guard(false, || runner.import_save(json))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ffi_rejects_empty_pack_and_reports_error() {
        let runner = unsafe { dotzuki_mobile_create(ptr::null(), 0, ptr::null(), 0) };
        assert!(runner.is_null());
        let len = unsafe { dotzuki_mobile_last_error(ptr::null_mut(), 0) };
        let mut message = vec![0; len];
        unsafe { dotzuki_mobile_last_error(message.as_mut_ptr(), message.len()) };
        assert!(String::from_utf8_lossy(&message).contains("null or empty"));
    }

    #[test]
    fn abi_is_versioned() {
        assert_eq!(dotzuki_mobile_abi_version(), 1);
    }
}
