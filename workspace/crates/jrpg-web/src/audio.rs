//! Real-engine audio playback bridge for editors.
//!
//! Renders a file-based [`TrackDef`](jrpg_audio::format::TrackDef) (the JSON the
//! jrpg-editor audio activity edits) to PCM using the *actual* `jrpg-audio`
//! sequencer + APU, so what the editor plays is exactly what the game plays —
//! no reimplementation, no drift. The editor feeds the returned samples into a
//! WebAudio `AudioBuffer`.

use wasm_bindgen::prelude::*;

use jrpg_audio::apu::Apu;
use jrpg_audio::format::TrackDef;
use jrpg_audio::sequencer::Sequencer;
use jrpg_audio::CPU_CLOCK_HZ;

/// Output sample rate for rendered PCM. Matches the reference native/iOS bridge.
pub const OUTPUT_SAMPLE_RATE: u32 = 48_000;

/// The sample rate (Hz) of the buffers returned by [`render_audio_pcm`].
#[wasm_bindgen]
pub fn audio_sample_rate() -> u32 {
    OUTPUT_SAMPLE_RATE
}

/// Render a track to interleaved **stereo `f32`** PCM at [`OUTPUT_SAMPLE_RATE`].
///
/// * `track_json` — a JSON [`TrackDef`] (music or SFX).
/// * `max_seconds` — hard cap on render length; music loops forever, so this
///   bounds it (SFX and non-looping tracks stop on their own, sooner).
///
/// Returns the raw little-endian bytes of the `f32` sample buffer (JS
/// reinterprets as a `Float32Array`: `[L0, R0, L1, R1, …]`). Returns an empty
/// buffer if the JSON fails to parse.
#[wasm_bindgen]
pub fn render_audio_pcm(track_json: &str, max_seconds: f32) -> Vec<u8> {
    let track: TrackDef = match serde_json::from_str(track_json) {
        Ok(t) => t,
        Err(e) => {
            crate::log_error(&format!("render_audio_pcm: bad track JSON: {e}"));
            return Vec::new();
        }
    };
    let samples = render_track_samples(&track, max_seconds);

    // Pack interleaved f32 as little-endian bytes for the wasm-bindgen boundary.
    let mut bytes = Vec::with_capacity(samples.len() * 4);
    for s in samples {
        bytes.extend_from_slice(&s.to_le_bytes());
    }
    bytes
}

/// Core render loop, shared by the wasm export and native tests.
///
/// Mirrors the shipping playback path (`pokered-ios`): power on the APU, start
/// the track on the sequencer, then per 1/60 s frame advance the sequencer and
/// pull `OUTPUT_SAMPLE_RATE / 60` stereo samples from the APU.
fn render_track_samples(track: &TrackDef, max_seconds: f32) -> Vec<f32> {
    let mut seq = Sequencer::new();
    let mut apu = Apu::new();
    // Power on. new() leaves NR50=0x77 / NR51=0xFF, and power_on() preserves
    // them, so master volume and panning are audible; the sequencer rewrites
    // NR51 each frame from the active channels.
    apu.write_register(0xFF26, 0x80);

    track.play_on(&mut seq);

    let cycles_per_sample = CPU_CLOCK_HZ / OUTPUT_SAMPLE_RATE;
    let samples_per_frame = (OUTPUT_SAMPLE_RATE / 60) as usize;
    let max_frames = (max_seconds.max(0.0) * 60.0).ceil() as usize;

    let mut out = Vec::with_capacity(samples_per_frame * max_frames * 2);
    let mut frame = 0;
    while seq.is_playing() && frame < max_frames {
        seq.update_frame(&mut apu);
        for _ in 0..samples_per_frame {
            apu.tick_n(cycles_per_sample);
            let (l, r) = apu.mix_sample();
            // mix_sample returns non-negative i16 in ~0..=480; scale to f32.
            out.push(l as f32 / 480.0);
            out.push(r as f32 / 480.0);
        }
        frame += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use jrpg_audio::format::{AudioCommand, ChannelDef, TrackDef, TrackKind};
    use jrpg_audio::HwChannel;

    fn demo_track() -> TrackDef {
        TrackDef {
            id: "Demo".into(),
            kind: TrackKind::Music,
            name: None,
            tempo: 0x0100,
            channels: vec![ChannelDef {
                hw: HwChannel::Pulse1,
                commands: vec![
                    AudioCommand::DutyCycle { value: 2 },
                    AudioCommand::NoteType { speed: 8, param: 0xF0 }, // vol 15, no fade
                    AudioCommand::Octave { value: 4 },
                    AudioCommand::Note { pitch: 0, length: 16 },
                ],
            }],
        }
    }

    #[test]
    fn renders_non_silent_pcm() {
        let samples = render_track_samples(&demo_track(), 0.25);
        assert!(!samples.is_empty(), "expected some samples");
        // Interleaved stereo → even length.
        assert_eq!(samples.len() % 2, 0);
        // A triggered note must produce at least one non-zero sample.
        assert!(
            samples.iter().any(|&s| s.abs() > 0.0),
            "rendered audio was completely silent"
        );
    }

    #[test]
    fn pcm_byte_export_is_f32_sized() {
        let json = serde_json::to_string(&demo_track()).unwrap();
        let bytes = render_audio_pcm(&json, 0.1);
        assert!(!bytes.is_empty());
        assert_eq!(bytes.len() % 4, 0, "f32 byte buffer must be 4-aligned");
    }

    #[test]
    fn bad_json_returns_empty() {
        assert!(render_audio_pcm("not json", 1.0).is_empty());
    }
}
