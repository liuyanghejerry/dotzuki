# Audio Runtime Reference

> - **Audience**: rust developers
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.5.4

The Rust runtime API of `dotzuki-audio`: the per-VBlank `AudioManager`
orchestrator and the device-output layer (`SampleSource` / `CpalOutput` /
`WebAudioOutput`).

The authoring side — [track](./glossary.md) JSON files and scene playback
calls — lives in [the audio guide](../how-to/audio.md), and the 22 channel
commands in [the audio commands reference](./audio-commands.md). This page
covers the code that plays those tracks:
`crates/dotzuki-audio/src/manager.rs` and `crates/dotzuki-audio/src/output/`.

## AudioManager

`AudioManager<M, S>` owns everything that happens once per VBlank (≈60 Hz) on
top of the [sequencer](./glossary.md) + [GB-APU](./glossary.md) pair: NR50
master-volume stamping, a music fade-out state machine, cross-track resume
snapshots, and SFX/cry playback with pitch and tempo modifiers. The id types
are generic — `M: Copy + Eq + Hash + 'static` (music), `S: Copy + 'static`
(SFX). Per-sample APU advancement belongs to the output layer, not to the
manager.

### Construction and track tables

The game hands its track tables over as two `fn` pointers — no capturing
closures — at construction: `AudioManager::new(music_track, sfx_track)` with
`fn(M) -> TrackData` and `fn(S) -> TrackData`.

| `TrackData` field | Type | Meaning |
|---|---|---|
| `sound_id` | `u8` | Engine sound id handed to the sequencer's channel state |
| `channels` | `[Option<&'static [u8]>; 4]` | Channel byte streams in hardware order (pulse1, pulse2, wave, noise); `None` slots are unused |
| `tempo` | `u16` | 16-bit fixed-point initial tempo; ignored for plain SFX (they run at `0x0100`, cries at `0x0080` + modifier) |

The fields `sequencer`, `apu`, `fade_state`, `fade_counter_reload`, and
`fade_queued_music` are public for engine-level integrations.

**The APU starts unpowered.** Someone — the output layer or the game — must
write NR52 (`0xFF26 = 0x80`) before any sound comes out; register writes to a
powered-down APU are ignored.

### Per-frame drive

Call `update_frame()` once per VBlank. Its order is fixed:

1. `process_fade` — step the fade state machine;
2. `apply_master_volume` — stamp NR50 from the logical left/right levels;
3. `sequencer.update_frame(&mut apu)` — tick the sound engine;
4. the post-frame hook, if any.

NR50 is stamped *before* the tick so an in-stream `volume` command can
override NR50 for the rest of that frame; the fade machinery re-owns NR50 on
the next frame. The post-frame hook runs *after* the tick, so a direct
register write there (an alarm poked into NR11–NR14, for example) overrides
whatever the sound engine produced that frame.

### Master volume

| Method | Effect |
|---|---|
| `master_volume_left()` / `master_volume_right()` | Logical per-side levels, 0–7 each |
| `set_master_volume(l, r)` | Clamps both sides to `0..=7`, writes NR50 at once |
| `nr50()` | The NR50 byte last stamped on the APU |

### Fade machine

`FadeState` is `None` or `FadingOut` (`fade_state()`, `is_fading()`).

- `play_music_with_fade(id, fade_speed)` — no-op when `id` is the current
  track; starts at once when nothing is playing; otherwise begins a fade with
  `id` queued behind it.
- `fade_out(fade_speed)` — fade to silence, then stop.
- `fade_out_then_play(id, fade_speed, on_restart)` — the `on_restart` hook
  (`FnOnce(&mut Sequencer) + Send`) runs right after the queued track starts,
  before the next tick.

The countdown lives in `Sequencer::fade_counter`: each frame decrements it,
and at zero it reloads from `fade_counter_reload` while both volume sides step
down by one (`saturating_sub`). When both reach 0 the fade completes: the
sequencer stops everything, the queued track starts through `play_music`, and
the taken fade-complete hook runs. `fade_speed = 0` steps once per frame —
7 steps plus one completion frame from full volume.

While no fade runs, the master volume is re-applied every frame — unless
`set_no_audio_fade_out(true)` was set, which lets in-stream `volume` writes
stick (read back with `no_audio_fade_out()`).

### Resume snapshots

`play_music(id)` clones the live sequencer into `saved_music_states` under the
old id when switching to a different track; requesting a track that has a
snapshot resumes it through `Sequencer::restore_music_from` instead of
restarting. `stop_music()` and `stop_all()` drop every snapshot;
`clear_saved_music_states()` drops them without touching playback (the
map-transition case), and `discard_saved_music_state(id)` makes one track
restart next time. `last_music_id()` reports the current track.

### SFX and cries

- `play_sfx(id)` — shorthand for `play_sfx_with_modifiers(id, 0, 0x0100)`.
- `play_sfx_with_modifiers(id, frequency_mod, tempo)` — installs
  `frequency_mod` as `Sequencer::frequency_modifier` (added to every note
  frequency) and `tempo` as the per-play SFX tempo: the cry path.
- `sfx_start_channel(id) -> Option<usize>` — the first hardware channel the
  SFX uses, so a game can gate SFX by channel.

`stop_sfx()` stops the SFX side; `stop_all()` stops music and SFX, ends any
fade, and drops resume snapshots. Queries: `is_music_playing()`,
`is_sfx_playing()`.

### Hooks

`set_post_frame_hook(Some(Box::new(...)))` installs a
`FnMut(&mut Apu, &mut Sequencer) + Send` closure that runs at the end of every
`update_frame`; passing `None` removes it. Both hook kinds carry a `Send`
bound so the manager can move across threads — the output layer pulls samples
on its own callback thread.

### Example

```rust
use dotzuki_audio::manager::{AudioManager, FadeState, TrackData};

static THEME_A_CH1: &[u8] = &[0xDC, 0xC7, 0xE5, 0x04, 0xFF];
static THEME_B_CH1: &[u8] = &[0xDC, 0xC7, 0xE5, 0x14, 0xFF];

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum Music { ThemeA, ThemeB }
#[derive(Clone, Copy)]
enum Sfx { Beep }

fn music_track(id: Music) -> TrackData {
    match id {
        Music::ThemeA => TrackData {
            sound_id: 1,
            channels: [Some(THEME_A_CH1), None, None, None],
            tempo: 0x0070,
        },
        Music::ThemeB => TrackData {
            sound_id: 2,
            channels: [Some(THEME_B_CH1), None, None, None],
            tempo: 0x0090,
        },
    }
}

fn sfx_track(_id: Sfx) -> TrackData {
    TrackData { sound_id: 0x40, channels: [None, None, None, None], tempo: 0 }
}

let mut mgr = AudioManager::new(music_track, sfx_track);
mgr.apu.write_register(0xFF26, 0x80); // NR52 power on — silent without it
mgr.set_master_volume(15, 3);         // clamps to (7, 3); NR50 reads 0x73
assert_eq!(mgr.nr50(), 0x73);

mgr.play_music(Music::ThemeA);        // resets volume to full
mgr.play_music_with_fade(Music::ThemeB, 0); // fade speed 0: one step per frame
while mgr.is_fading() {
    mgr.update_frame(); // once per VBlank: fade → NR50 → sequencer tick
}
assert_eq!(mgr.last_music_id(), Some(Music::ThemeB));
assert_eq!(mgr.fade_state(), FadeState::None);
```

*Verified by `fade_steps_volume_down_then_switches_music` and
`set_master_volume_clamps_and_writes_nr50` in
`crates/dotzuki-audio/src/manager.rs`.*

## Output layer

The output layer is pull-model glue between the emulated APU and a real audio
backend. A source renders interleaved stereo `f32` at the device rate; the
backend's callback thread ticks the APU `CPU_CLOCK_HZ / sample_rate` cycles
per sample and mixes via `Apu::mix_sample`, while the game thread advances
only the sequencer, once per video frame.

| Feature | Item | Platform | Default |
|---|---|---|---|
| `cpal` | `CpalOutput` | native | off |
| `web-audio` | `WebAudioOutput` | wasm32 only | off |
| — | `SampleSource`, `render_apu_stereo` | all | always compiled |

Constants: `OUTPUT_SAMPLE_RATE = 44_100`; `MAX_AMPLITUDE = 480.0`, the APU
peak used to normalise `mix_sample`'s `i16` output into `[-1.0, 1.0]`; the
crate-level `CPU_CLOCK_HZ = 4_194_304` and `SAMPLE_RATE = 44_100`.

### SampleSource and render_apu_stereo

```rust
pub trait SampleSource: Send + 'static {
    fn render(&mut self, out: &mut [f32], sample_rate: u32);
}
```

*Verified by `closure_is_a_sample_source` in
`crates/dotzuki-audio/src/output/mod.rs`.*

A blanket impl covers any `FnMut(&mut [f32], u32) + Send + 'static` closure,
so a frontend captures the shared `Arc<Mutex<…>>` that owns the APU and
renders from it on the callback thread. `render_apu_stereo(apu, out,
sample_rate)` is the single sample path every backend uses, so all frontends
render byte-identical audio:

```rust
use dotzuki_audio::apu::Apu;
use dotzuki_audio::output::{render_apu_stereo, SampleSource, OUTPUT_SAMPLE_RATE};

let mut apu = Apu::new();
let mut source = move |out: &mut [f32], rate: u32| {
    render_apu_stereo(&mut apu, out, rate);
};
let mut buf = vec![1.0; 16];
SampleSource::render(&mut source, &mut buf, OUTPUT_SAMPLE_RATE);
assert!(buf.iter().all(|&s| s == 0.0)); // a powered-off APU mixes silence
```

*Verified by `closure_is_a_sample_source` and
`render_apu_stereo_fills_interleaved_frames` in
`crates/dotzuki-audio/src/output/mod.rs`.*

### CpalOutput (feature `cpal`, native)

`CpalOutput::new(source) -> Option<CpalOutput>` opens the default host's
default output device at stereo 44.1 kHz and starts pulling from the source on
cpal's callback thread. `None` means no output device (CI, headless) or a
stream failure — the caller continues silent. Dropping the output stops the
stream.

### WebAudioOutput (feature `web-audio`, wasm32 only)

`WebAudioOutput::new(source) -> Option<WebAudioOutput>` requests a 44.1 kHz
`AudioContext` (falling back to the device default rate) and wires a
`ScriptProcessorNode` — buffer 2048 (≈46 ms), 0 inputs, 2 outputs — to the
destination. `sample_rate()` reports the negotiated rate: browsers may ignore
the 44.1 kHz request, and the negotiated rate is what the source receives on
every render. Browsers gate audio behind a user gesture, so call
`try_resume()` before play commands.

## Consumption patterns

### Native: a closure over the shared engine

`dotzuki-runner` enables `dotzuki-audio` features `["serde", "cpal"]`. Its
`render_into` (`crates/dotzuki-runner/src/audio.rs`) calls
`render_apu_stereo` — plus the modern mixer when enabled — and is the single
path shared by the cpal callback and PCM `render_samples`:

<!-- not verified -->
```rust
use dotzuki_audio::output::CpalOutput;

let output = CpalOutput::new(move |data: &mut [f32], _rate: u32| {
    let mut engine = shared_engine.lock().unwrap();
    render_into(&mut engine, data); // render_apu_stereo + optional mixer
});
// output == None → no device: keep the game running silent.
```

### WASM: pull PCM per video frame

The WASM runner (`dotzuki-runner-web`) does not use `WebAudioOutput`: on
wasm32 cpal's Null host has no real output, so there is no callback thread to
drive the APU. Instead the runner's `tick` renders one video frame's worth of
PCM — `44_100 / 59.7275 ≈ 738.4` stereo frames through a fractional
accumulator — via `render_samples`, and the host drains it with `take_audio`
into a WebAudio queue.

### NR50 ordering: two frame loops, two winners

`AudioManager::update_frame` stamps NR50 *before* the sequencer tick, so an
in-stream `volume` command can override NR50 for the rest of the frame. The
runner's own `update_engine_frame` stamps NR50 *after* the tick, so its fade
outlives in-stream writes. Pick the ordering that matches who should win when
a track carries `volume` commands.

## Gotchas

- A fresh `AudioManager` stays silent until NR52 (`0xFF26 = 0x80`) is written.
- Track tables are `fn` pointers, not closures; shared state must live behind
  the id types or in statics.
- `CpalOutput::new` returns `None` on machines with no output device —
  continue silent instead of panicking.
- Hooks run on the game thread at frame rate; keep them short.
