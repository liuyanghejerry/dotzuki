# Audio Authoring Guide

`dotzuki run` plays music and sound effects from declarative **JSON track
files** under `<dataRoot>/audio/`. There is no binary audio format to compile
to: a track is a `TrackDef` document describing which of the four Game Boy
hardware channels play which commands, and the runtime sequencer plays it
directly.

The runtime is backed by `dotzuki-audio` (a game-agnostic GB-APU emulation +
sequencer). See `crates/dotzuki-audio/src/format.rs` for the authoritative
schema.

## Layout

Tracks live anywhere under `<dataRoot>/audio/` (loaded recursively — the
`music/` + `sfx/` split below is a convention, not a rule):

```
data/audio/
├── music/
│   └── town.json          # {"id": "town", "kind": "music", ...}
└── sfx/
    └── confirm.json       # {"id": "confirm", "kind": "sfx", ...}
```

The **`id`** field is the stable identifier: scene code refers to a track by
`id` (e.g. `playMusic("town")`, `playSound("confirm")`), not by file name.

**Audio is fully optional.** A project without `data/audio/` runs fine: every
audio command is a silent no-op. On hosts with no output device (CI, headless)
the runtime logs one warning and stays silent; `--headless` never opens a
device.

## TrackDef JSON

```json
{
  "id": "town",
  "kind": "music",
  "name": "Town Theme",
  "tempo": 256,
  "channels": [
    {
      "hw": "pulse1",
      "commands": [
        { "type": "note", "pitch": 0, "length": 4 },
        { "type": "rest", "length": 2 }
      ]
    }
  ]
}
```

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Stable identifier referenced by scenes (required) |
| `kind` | `"music"` \| `"sfx"` | Music plays on channels 1–4 with `tempo`; SFX play at a fixed tempo on their own channels |
| `name` | string, optional | Human-readable display name |
| `tempo` | integer | 8.8 fixed-point tempo (`256` = 1.0); music only |
| `channels` | array | One entry per used hardware channel |

### Channel (`ChannelDef`)

| Field | Type | Meaning |
|---|---|---|
| `hw` | `"pulse1"` \| `"pulse2"` \| `"wave"` \| `"noise"` | Target hardware channel |
| `commands` | array of `AudioCommand` | The channel's command list |

### Commands (`AudioCommand`)

Commands serialize internally-tagged: `{"type": "<name>", ...}`. This mirrors
the engine's byte-code channel commands one-to-one.

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

## Playing tracks from scenes

Scene code controls audio through the `game` runtime API (from `.scene` via
bare commands, `@command(...)`, or `@run { ... }`):

| Call | Effect |
|---|---|
| `playMusic("id")` | Start a music track; re-requesting the current track is a no-op (BGM isn't restarted every map entry) |
| `playSound("id")` | Play an SFX once |
| `stopMusic()` | Stop the current music |
| `fadeOutMusic()` | Fade the master volume 7→0 (~1.2 s) then stop |

Music is **deduplicated** by track id — calling `playMusic` with the currently
playing id does not restart the song. Fade-outs step the master volume one
level every 10 video frames before cutting the track.

## Authoring notes

- Music is written for the four GB channels; real GB music uses channels
  contiguously from `pulse1`, and channel streams are encoded from the `hw`
  index (unused interior slots become empty, trailing empties trimmed).
- `pitch` is a semitone 0–11 within the current octave — there is no note-name
  syntax in the file format; higher-level niceties (note names, volume/fade
  splits) belong in the editor's Audio activity, not the file.
- The same `id` must not be duplicated across track files (the library keys by
  id).
