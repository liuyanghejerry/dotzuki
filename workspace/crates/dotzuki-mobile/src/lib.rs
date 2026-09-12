//! Game-independent mobile runtime. Platforms own presentation and persistence.
//! Games implement MobileGame; export_mobile_abi! supplies the common C boundary.
use std::cell::RefCell;
use std::ffi::CString;
use std::panic::{catch_unwind, AssertUnwindSafe};
mod audio_ring;
use audio_ring::AudioRing;
pub const ABI_VERSION: u32 = 1;
pub const AUDIO_SAMPLE_RATE: u32 = 44_100;
pub const GAME_FRAME_RATE: f64 = 59.7275;

/// Game operations called only by the serialized game thread.
/// Pixel dimensions remain constant for the lifetime of this game instance.
pub trait MobileGame {
    fn dimensions(&self) -> (u32, u32);
    fn tick(&mut self, input: u8);
    fn copy_rgba(&self, output: &mut [u8]);
    /// Fill 44.1 kHz stereo interleaved PCM from the active game sound source.
    fn render_audio(&mut self, output: &mut [f32]);
    /// Export the game's committed save, not an arbitrary transient snapshot.
    fn export_save(&self) -> Option<String>;
    fn import_save(&mut self, json: &str) -> bool;
}
struct MainState {
    game: Box<dyn MobileGame>,
    fraction: f64,
    pcm: Vec<f32>,
}
/// Opaque C handle. Deliberately not Send/Sync: safe Rust callers cannot race
/// game methods. FFI hosts serialize game calls; only audio_fill may run concurrently.
pub struct MobileRuntime {
    main: RefCell<MainState>,
    audio: AudioRing,
    width: u32,
    height: u32,
}
impl MobileRuntime {
    pub fn new(game: impl MobileGame + 'static) -> Result<Self, String> {
        let (width, height) = game.dimensions();
        if width == 0 || height == 0 || width > 4096 || height > 4096 {
            return Err("invalid mobile framebuffer dimensions".into());
        }
        Ok(Self {
            main: RefCell::new(MainState {
                game: Box::new(game),
                fraction: 0.0,
                pcm: vec![0.0; 1480],
            }),
            audio: AudioRing::new(),
            width,
            height,
        })
    }
    pub fn tick(&self, input: u8) {
        let mut main = self.main.borrow_mut();
        main.game.tick(input);
        main.fraction += AUDIO_SAMPLE_RATE as f64 / GAME_FRAME_RATE;
        let frames = main.fraction.floor() as usize;
        main.fraction -= frames as f64;
        let MainState { game, pcm, .. } = &mut *main;
        pcm.resize(frames * 2, 0.0);
        game.render_audio(pcm);
        self.audio.push(pcm);
    }
    pub fn copy_frame(&self, output: &mut [u8]) -> Result<usize, usize> {
        let required = self.frame_len();
        if output.len() < required {
            return Err(required);
        }
        self.main.borrow().game.copy_rgba(&mut output[..required]);
        Ok(required)
    }
    pub fn fill_audio(&self, output: &mut [f32]) -> u32 {
        (self.audio.pop(output) / 2) as u32
    }
    pub fn export_save(&self) -> Option<String> {
        self.main.borrow().game.export_save()
    }
    pub fn import_save(&self, json: &str) -> bool {
        self.main.borrow_mut().game.import_save(json)
    }
    pub const fn width(&self) -> u32 {
        self.width
    }
    pub const fn height(&self) -> u32 {
        self.height
    }
    pub fn frame_len(&self) -> usize {
        self.width as usize * self.height as usize * 4
    }
}
thread_local! {
    #[doc(hidden)]
    pub static LAST_ERROR: RefCell<CString> = RefCell::new(CString::new("no error").unwrap());
}
#[doc(hidden)]
pub fn set_last_error(message: impl AsRef<str>) {
    let cleaned = message.as_ref().replace('\0', " ");
    LAST_ERROR.with(|slot| *slot.borrow_mut() = CString::new(cleaned).unwrap());
}
#[doc(hidden)]
pub fn ffi_guard<T>(fallback: T, operation: impl FnOnce() -> T) -> T {
    match catch_unwind(AssertUnwindSafe(operation)) {
        Ok(value) => value,
        Err(_) => {
            set_last_error("mobile runtime panicked");
            fallback
        }
    }
}
/// Export ABI v1 with a game-specific factory (initialization bytes, optional save).
/// The factory returns Result<MobileRuntime, String>. Link exactly one factory.
/// Safety: valid pointer/length pairs; serialize all game calls; one audio callback;
/// stop and join the audio callback before destroying the handle.
#[macro_export]
macro_rules! export_mobile_abi {
    ($factory:path) => {
        /// Return [`$crate::ABI_VERSION`].
        #[no_mangle]
        pub extern "C" fn dotzuki_mobile_abi_version() -> u32 {
            $crate::ABI_VERSION
        }

        /// Copy the calling thread's last error as a NUL-terminated UTF-8 string.
        ///
        /// The return value includes the trailing NUL. Passing a null output or a
        /// small capacity performs a size query and writes nothing.
        #[no_mangle]
        pub unsafe extern "C" fn dotzuki_mobile_last_error(
            output: *mut u8,
            capacity: usize,
        ) -> usize {
            $crate::LAST_ERROR.with(|slot| {
                let error = slot.borrow();
                let bytes = error.as_bytes_with_nul();
                if !output.is_null() && capacity >= bytes.len() {
                    // SAFETY: the caller promises a writable buffer of `capacity` bytes.
                    unsafe { std::ptr::copy_nonoverlapping(bytes.as_ptr(), output, bytes.len()) };
                }
                bytes.len()
            })
        }

        /// Create a runtime from game-specific initialization bytes and optional UTF-8 save JSON.
        #[no_mangle]
        pub unsafe extern "C" fn dotzuki_mobile_create(
            pack: *const u8,
            pack_len: usize,
            save: *const u8,
            save_len: usize,
        ) -> *mut $crate::MobileRuntime {
            if pack.is_null() || pack_len == 0 {
                $crate::set_last_error("initialization payload is null or empty");
                return std::ptr::null_mut();
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
                        $crate::set_last_error(format!("save is not UTF-8: {error}"));
                        return std::ptr::null_mut();
                    }
                }
            };
            $crate::ffi_guard(std::ptr::null_mut(), || match ($factory)(pack, save) {
                Ok(runner) => Box::into_raw(Box::new(runner)),
                Err(error) => {
                    $crate::set_last_error(error);
                    std::ptr::null_mut()
                }
            })
        }

        /// Destroy a runner. The platform must stop its audio callback first.
        #[no_mangle]
        pub unsafe extern "C" fn dotzuki_mobile_destroy(runner: *mut $crate::MobileRuntime) {
            if !runner.is_null() {
                // SAFETY: the pointer came from `dotzuki_mobile_create` and is unique.
                unsafe { drop(Box::from_raw(runner)) };
            }
        }

        #[no_mangle]
        pub unsafe extern "C" fn dotzuki_mobile_width(runner: *const $crate::MobileRuntime) -> u32 {
            runner
                .as_ref()
                .map($crate::MobileRuntime::width)
                .unwrap_or(0)
        }

        #[no_mangle]
        pub unsafe extern "C" fn dotzuki_mobile_height(
            runner: *const $crate::MobileRuntime,
        ) -> u32 {
            runner
                .as_ref()
                .map($crate::MobileRuntime::height)
                .unwrap_or(0)
        }

        #[no_mangle]
        pub unsafe extern "C" fn dotzuki_mobile_frame_len(
            runner: *const $crate::MobileRuntime,
        ) -> usize {
            runner
                .as_ref()
                .map($crate::MobileRuntime::frame_len)
                .unwrap_or(0)
        }

        /// Advance and render one frame. Returns `false` for a null runner.
        #[no_mangle]
        pub unsafe extern "C" fn dotzuki_mobile_tick(
            runner: *mut $crate::MobileRuntime,
            input_bits: u8,
        ) -> bool {
            let Some(runner) = runner.as_ref() else {
                $crate::set_last_error("runner is null");
                return false;
            };
            $crate::ffi_guard(false, || {
                runner.tick(input_bits);
                true
            })
        }

        /// Copy the last RGBA frame. Returns the required byte count, even when the
        /// output buffer is null or too small.
        #[no_mangle]
        pub unsafe extern "C" fn dotzuki_mobile_copy_frame(
            runner: *const $crate::MobileRuntime,
            output: *mut u8,
            capacity: usize,
        ) -> usize {
            let Some(runner) = runner.as_ref() else {
                $crate::set_last_error("runner is null");
                return 0;
            };
            let required = runner.frame_len();
            if output.is_null() || capacity < required {
                return required;
            }
            $crate::ffi_guard(0, || {
                // SAFETY: the caller promises a writable buffer of `capacity` bytes.
                let output = unsafe { std::slice::from_raw_parts_mut(output, capacity) };
                runner.copy_frame(output).unwrap_or(required)
            })
        }

        /// Pull interleaved stereo `f32` PCM. Returns stereo frames copied.
        #[no_mangle]
        pub unsafe extern "C" fn dotzuki_mobile_audio_fill(
            runner: *const $crate::MobileRuntime,
            output: *mut f32,
            frames: u32,
        ) -> u32 {
            let Some(runner) = runner.as_ref() else {
                return 0;
            };
            if output.is_null() || frames == 0 {
                return 0;
            }
            $crate::ffi_guard(0, || {
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
            runner: *const $crate::MobileRuntime,
            output: *mut u8,
            capacity: usize,
        ) -> usize {
            let Some(runner) = runner.as_ref() else {
                return 0;
            };
            $crate::ffi_guard(0, || {
                let Some(save) = runner.export_save() else {
                    return 0;
                };
                let bytes = save.as_bytes();
                if !output.is_null() && capacity >= bytes.len() {
                    // SAFETY: the caller promises a writable buffer of `capacity` bytes.
                    unsafe { std::ptr::copy_nonoverlapping(bytes.as_ptr(), output, bytes.len()) };
                }
                bytes.len()
            })
        }

        #[no_mangle]
        pub unsafe extern "C" fn dotzuki_mobile_import_save(
            runner: *mut $crate::MobileRuntime,
            save: *const u8,
            save_len: usize,
        ) -> bool {
            let (Some(runner), false) = (runner.as_ref(), save.is_null()) else {
                $crate::set_last_error("runner or save is null");
                return false;
            };
            // SAFETY: the caller promises a readable `save_len` region.
            let bytes = unsafe { std::slice::from_raw_parts(save, save_len) };
            let Ok(json) = std::str::from_utf8(bytes) else {
                $crate::set_last_error("save is not UTF-8");
                return false;
            };
            $crate::ffi_guard(false, || runner.import_save(json))
        }
    };
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Game {
        width: u32,
        frames: usize,
    }
    impl MobileGame for Game {
        fn dimensions(&self) -> (u32, u32) {
            (self.width, 144)
        }
        fn tick(&mut self, input: u8) {
            self.frames += input as usize;
        }
        fn copy_rgba(&self, out: &mut [u8]) {
            out.fill(self.frames as u8);
        }
        fn render_audio(&mut self, out: &mut [f32]) {
            out.fill(0.25);
        }
        fn export_save(&self) -> Option<String> {
            Some(self.frames.to_string())
        }
        fn import_save(&mut self, save: &str) -> bool {
            if let Ok(frames) = save.parse() {
                self.frames = frames;
                true
            } else {
                false
            }
        }
    }
    #[test]
    fn custom_game_dimensions_and_save_contract() {
        for width in [160, 320] {
            let host = MobileRuntime::new(Game { width, frames: 0 }).unwrap();
            host.tick(3);
            let mut pixels = vec![0; host.frame_len()];
            host.copy_frame(&mut pixels).unwrap();
            assert!(pixels.iter().all(|b| *b == 3));
            assert_eq!(host.frame_len(), width as usize * 144 * 4);
            assert!(!host.import_save("invalid"));
            assert_eq!(host.export_save().as_deref(), Some("3"));
            let mut pcm = [0.0; 2048];
            assert!(host.fill_audio(&mut pcm) > 0);
            assert_eq!(pcm[0], 0.25);
        }
        assert!(MobileRuntime::new(Game {
            width: 0,
            frames: 0
        })
        .is_err());
    }
}
