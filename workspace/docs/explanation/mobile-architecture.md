# Mobile Architecture

> - **Audience**: rust developers, engine contributors
> - **Type**: explanation
> - **Status**: active
> - **Last verified**: v0.6.1

Why dotzuki uses one Rust runtime contract and a native shell for each mobile
platform, with Android and HarmonyOS using the same versioned C ABI.

## Decision

The [`mobile runtime`](../reference/glossary.md#engine) is the shared game
boundary. Each [`mobile shell`](../reference/glossary.md#engine) owns the APIs
that its operating system expects:

```text
zero-Rust project -> game.dzpk -> dotzuki-runner-mobile
                                      |
               C ABI: tick / RGBA / PCM / save / input
                  /                   |                  \
       iOS shell                Android shell         HarmonyOS shell
 Metal + Swift audio       SurfaceView + AudioTrack   XComponent + GLES3
 SwiftUI/UIKit lifecycle       Kotlin Activity         ArkTS + OHAudio
```

The Rust side loads project data, advances `RunnerGame`, renders a 320×240
RGBA frame, produces interleaved stereo PCM, and serializes saves. A shell
controls display timing, texture presentation, touch input, audio callbacks,
application lifecycle, and private storage.

This split follows the existing iOS ownership model: Swift owns the Apple
frameworks while Rust exports data and state through a narrow C interface.
Android and HarmonyOS apply the same split through their native UI, display,
audio, lifecycle, and storage APIs.

## Why the shell owns the Android window loop

The earlier game-specific Android port put `winit`, `pixels`, and the native
activity loop inside Rust. Platform features then entered through separate
Kotlin overlays and callbacks. The shared Android shell now owns the Activity,
`Choreographer`, `SurfaceView`, `AudioTrack`, touch controls, and
`SharedPreferences`. Rust remains behind the same frame, input, audio, and
persistence contract used by HarmonyOS.

## Contract

`dotzuki-mobile/include/dotzuki_runner_mobile.h` defines ABI version 1.
The contract contains these groups:

| Group | Calls | Ownership |
|---|---|---|
| lifetime | `create`, `destroy`, `abi_version`, `last_error` | shell passes a copied `.dzpk` buffer |
| frame loop | `tick`, `width`, `height`, `frame_len`, `copy_frame` | game thread advances and copies RGBA |
| input | the `tick` bitmask | A, B, Select, Start, Right, Left, Up, Down use bits 0–7 |
| audio | `audio_fill` | one real-time consumer pulls stereo PCM at 44.1 kHz |
| persistence | `export_save`, `import_save` | shell stores UTF-8 JSON in platform-private storage |

The game thread is the sole caller for frame and save operations. One audio
callback may call `audio_fill` concurrently. A lock-free single-producer,
single-consumer ring separates the game loop from the audio callback.

Mobile hosts set `RunnerOptions::external_saves`. This prevents disk loading
and writes, including the Start menu's Save command. The shell imports a save
at boot and exports one at a stable state.

## Platform mapping

| Concern | iOS | Android | HarmonyOS |
|---|---|---|---|
| frame clock | `CADisplayLink` | `Choreographer` | XComponent frame callback |
| surface | `MTKView` / Metal | `SurfaceView` / Canvas | `XComponent` / `NativeWindow` |
| pixels | Metal texture upload | nearest-neighbor bitmap copy | EGL/GLES3 texture upload |
| audio | `AVAudioEngine` callback | `AudioTrack` stream | OHAudio renderer callback |
| lifecycle | UIKit/SwiftUI | Activity | `UIAbility` and page lifecycle |
| save store | app container | `SharedPreferences` | Preferences |

The Android and HarmonyOS exporters implement their columns through ABI
version 1. The existing iOS shell follows the ownership pattern through its
game-specific ABI and can migrate without changing `RunnerGame` or project
packs.

## Compatibility boundary

The shell checks `dotzuki_mobile_abi_version()` before it relies on a contract
revision. A project pack remains platform-neutral. Save compatibility stays
governed by `SAVE_VERSION`, not by the shell or the C ABI version.

The Rust compiler lists HarmonyOS targets as Tier 2 with host tools. The
target still needs an OpenHarmony SDK linker configuration. Huawei's NDK
samples define the platform-side XComponent and OHAudio integration used by
the generated shell:

- [Rust HarmonyOS target support](https://doc.rust-lang.org/rustc/platform-support/openharmony.html)
- [Huawei NDK XComponent sample](https://gitee.com/harmonyos_samples/ndk-xcomponent)
- [Huawei Node-API guide](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/napi-introduction-V5)

## Custom Rust games

`dotzuki-mobile` owns `MobileGame`, the opaque runtime, bounded PCM queue and
`export_mobile_abi!`. It has no game, renderer, or device dependencies.
`dotzuki-runner-mobile` implements the contract for `RunnerGame` and `.dzpk`.
A custom Rust game links `dotzuki-mobile` and exports its own factory instead;
link exactly one factory per application. That factory defines the
initialization bytes and the save JSON. The host queries frame dimensions
from the runtime.

The common Android and HarmonyOS hosts use a monotonic fixed-step clock
(59.7275 Hz), nearest sampling, a separate touch-control area, and 44.1 kHz
PCM. They poll committed saves every 500 ms and flush during lifecycle
transitions. A game controls what constitutes a committed save. Persistence is
asynchronous, so abrupt process death before a flush completes can lose the
latest commit. Stop audio callbacks before destroying the runtime.

For a custom static library, `scripts/export-mobile-host.py --help` documents
exporting the same host without the zero-Rust project validation/pack step.
Its output directory must be empty. The game's build wrapper supplies a library,
initialization bytes, title, and bundle name; it does not copy platform sources
into the game's repository.
