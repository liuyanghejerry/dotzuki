# Audio Command Reference

> - **Audience**: game authors
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.1.0

The 22 `AudioCommand` variants that channel command lists may contain, with
their fields; see [the audio guide](../how-to/audio.md) for the `TrackDef`
format and playback calls.

Commands serialize internally-tagged: `{"type": "<name>", ...}`. This mirrors
the engine's byte-code channel commands one-to-one. The authoritative schema is
`crates/dotzuki-audio/src/format.rs`.

| `type` | Fields | Meaning |
|---|---|---|
| `note` | `pitch` 0–11 (C..B), `length` 1–16 | Play a note |
| `drum_note` | `length` 1–16, `instrument` | Noise-channel drum note |
| `rest` | `length` 1–16 | Silence |
| `note_type` | `speed`, `param` | Note speed + volume/envelope byte (wave channel: low nibble = wave instrument) |
| `octave` | `value` 0–7 | Set octave (musical octave = 8 − value) |
| `toggle_perfect_pitch` | — | Toggle the perfect-pitch flag |
| `vibrato` | `delay`, `depth_rate` (depth<<4 \| rate) | Vibrato with onset delay |
| `pitch_slide` | `length_modifier`, `octave_pitch` (octave<<4 \| pitch) | Begin a pitch slide |
| `duty_cycle` | `value` 0–3 | Square-wave duty cycle |
| `tempo` | `value` | Set tempo (8.8 fixed-point) |
| `stereo_panning` | `value` | NR51 panning byte |
| `unknown_ef` | `value` | Unused `$EF` command (round-trip only) |
| `volume` | `value` | Master volume (NR50) |
| `execute_music` | — | Toggle SFX channel's execute-music flag |
| `duty_cycle_pattern` | `value` | Duty rotation pattern (4 × 2-bit) |
| `sound_call` | `offset` | Call a subroutine at a channel-stream byte offset |
| `sound_loop` | `count` (0 = infinite), `offset` | Loop back to an offset |
| `sound_ret` | — | Return from a `sound_call` |
| `pitch_sweep` | `param` | Channel-1 pitch sweep (NR10); SFX only |
| `sfx_square_note` | `length`, `volume_envelope`, `frequency` | SFX square note with explicit envelope + 11-bit frequency |
| `sfx_noise_note` | `length`, `volume_envelope`, `noise_params` | SFX noise note with explicit envelope |
| `end_of_data` | — | Terminator |
