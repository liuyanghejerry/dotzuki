# Mobile Architecture

> - **Audience**: rust developers, engine contributors
> - **Type**: explanation
> - **Status**: active
> - **Last verified**: v0.6.0

Why dotzuki uses one Rust runtime contract and a native shell for each mobile
platform, and how the HarmonyOS shell follows the iOS ownership model.

## Decision

The [`mobile runtime`](../reference/glossary.md#engine) is the shared game
boundary. Each [`mobile shell`](../reference/glossary.md#engine) owns the APIs
that its operating system expects:

```text
zero-Rust project -> game.dzpk -> dotzuki-runner-mobile
                                      |
               C ABI: tick / RGBA / PCM / save / input
                  /                   |                  \
       iOS shell                Android shell       HarmonyOS shell
 Metal + Swift audio       Surface + platform audio  XComponent + GLES3
 SwiftUI/UIKit lifecycle   Kotlin lifecycle           ArkTS + OHAudio
```

The Rust side loads project data, advances `RunnerGame`, renders a 320×240
RGBA frame, produces interleaved stereo PCM, and serializes saves. A shell
controls display timing, texture presentation, touch input, audio callbacks,
application lifecycle, and private storage.

This split matches the existing iOS implementation's strongest property:
Swift owns every Apple framework while Rust exports data and state through a
narrow C interface. HarmonyOS applies the same split through ArkTS, Node-API,
XComponent, EGL/GLES3, and OHAudio.

## Why the Android window loop is not the shared boundary

The existing Android port puts `winit`, `pixels`, and the native activity loop
inside Rust. That route provides a working window path, but platform features
enter through separate Kotlin overlays and callbacks. Audio, saves, and
lifecycle then cross different boundaries.

Reusing that loop on HarmonyOS would bind the engine to another window
adapter and would still require ArkTS bridges for mobile services. The common
C ABI keeps window frameworks out of `dotzuki-runner` and gives all three
shells the same frame, input, audio, and persistence contract.

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

| Concern | iOS | Android target | HarmonyOS |
|---|---|---|---|
| frame clock | `CADisplayLink` | `Choreographer` | XComponent frame callback |
| surface | `MTKView` / Metal | `SurfaceView` or `TextureView` | `XComponent` / `NativeWindow` |
| pixels | Metal texture upload | GLES/Vulkan texture upload | EGL/GLES3 texture upload |
| audio | `AVAudioEngine` callback | AAudio/Oboe callback | OHAudio renderer callback |
| lifecycle | UIKit/SwiftUI | Activity | `UIAbility` and page lifecycle |
| save store | app container | app-private files | Preferences |

The HarmonyOS exporter implements the right column. The existing iOS shell
already follows the ownership pattern through its game-specific ABI. Android
and iOS can migrate to ABI version 1 without changing `RunnerGame` or project
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
link exactly one factory per application. Initialization bytes and save JSON
are defined by that factory. Frame dimensions are queried from the runtime.

The common Harmony host uses a monotonic fixed-step clock (59.7275 Hz), nearest
texture sampling, a separate touch-control area, and 44.1 kHz PCM. It polls
committed saves every 500 ms and flushes on page hide. A game controls what
constitutes a committed save; backgrounding does not require a new snapshot.
Persistence is asynchronous, so abrupt process death before a flush completes
can lose the latest commit. Stop audio callbacks before destroying the runtime.

For a custom static library, `scripts/export-mobile-host.py --help` documents
exporting the same host without the zero-Rust project validation/pack step.
Its output directory must be empty. The game's build wrapper supplies a library,
initialization bytes, title, and bundle name; it does not copy platform sources
into the game's repository.
