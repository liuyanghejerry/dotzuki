# Audio Authoring Guide

> - **Audience**: game authors
> - **Type**: how-to
> - **Status**: active
> - **Last verified**: v0.1.0

Declarative JSON track files describe music and SFX for the four GB hardware
channels; the 22-command list lives in [the audio commands
reference](../reference/audio-commands.md).

## Before you start

Read [the audio commands reference](../reference/audio-commands.md) for the
command vocabulary used below.

`dotzuki run` plays music and sound effects from declarative **JSON track
files** under `<dataRoot>/audio/`. There is no binary audio format to compile
to: a track is a `TrackDef` document describing which of the four Game Boy
hardware channels play which commands, and the runtime sequencer plays it
directly.

`dotzuki-audio` backs the runtime: a game-agnostic GB-APU emulation plus
sequencer. See `crates/dotzuki-audio/src/format.rs` for the authoritative
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
the engine's byte-code channel commands one-to-one. The full 22-command table
with field semantics lives in the
[audio commands reference](../reference/audio-commands.md).

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

## File audio (WAV / OGG / FLAC / MP3) — optional

Besides JSON `TrackDef` chiptune, the runtime can play **real audio files**
(WAV, OGG-Vorbis, FLAC, MP3) streamed through the engine's modern mixer, with
volume/pan/fade, BGM/SFX mixing buses and per-bus DSP (lowpass, reverb).

This is an **optional, build-time capability**: the runtime must be compiled
with the `modern-audio` feature (games enable it on their `dotzuki-runner` /
`dotzuki-web` dependency). Without the feature, audio files are ignored and
file-track commands stay silent no-ops — nothing is compiled in and no
decoder dependency is built.

### Layout

Audio files live anywhere under `<dataRoot>/audio/` alongside JSON tracks
(loaded recursively):

```
data/audio/
├── music/
│   ├── town.json          # chiptune TrackDef (checked first)
│   └── field.ogg          # streamed file track
└── sfx/
    ├── confirm.json
    └── hit.wav
```

A file track's **id** is its path relative to `audio/` with the extension
stripped: `data/audio/music/field.ogg` → `playMusic("music/field")`.

### Semantics

- File BGM tracks **loop**; they deduplicate like JSON tracks
  (`playMusic` with the currently playing id is a no-op) and cross-fade when
  replaced (`fadeOutMusic` fades them out over ~1.2 s).
- File SFX tracks play once on the SFX bus.
- A JSON `TrackDef` whose id collides with a file track **wins** — JSON is
  always checked first.
- File BGM and chiptune can play at the same time (they mix in the output);
  `stopMusic` / `fadeOutMusic` stop whichever is currently playing.
- Files are **streamed**: the compressed bytes stay in memory and PCM is
  decoded block-by-block, so a long OGG never occupies fully-decoded RAM.

## Authoring notes

- Music is written for the four GB channels; real GB music uses channels
  contiguously from `pulse1`, and channel streams are encoded from the `hw`
  index (unused interior slots become empty, trailing empties trimmed).
- `pitch` is a semitone 0–11 within the current octave — there is no note-name
  syntax in the file format; higher-level niceties (note names, volume/fade
  splits) belong in the editor's Audio activity, not the file.
- The same `id` must not be duplicated across track files (the library keys by
  id).
