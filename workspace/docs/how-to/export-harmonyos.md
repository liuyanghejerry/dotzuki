# Export a Game for HarmonyOS

> - **Audience**: game authors, engine contributors
> - **Type**: how-to
> - **Status**: active
> - **Last verified**: v0.6.0

Build the common mobile runtime and export a zero-Rust game as a DevEco
Studio HarmonyOS project.

Before you start, read [Publishing & Upgrading](./publishing.md) and install
DevEco Studio with HarmonyOS SDK 5.0.5 (API 17) or a compatible newer SDK.

## 1. Build the Rust mobile runtime

Install Rust's HarmonyOS target:

```bash
rustup target add aarch64-unknown-linux-ohos
```

Point Cargo's target linker at the OpenHarmony SDK's Clang wrapper. The
wrapper path depends on the SDK installation. Then build the static library
from `workspace/`:

```bash
export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_OHOS_LINKER=/path/to/ohos-clang-wrapper
cargo build --release \
  --target aarch64-unknown-linux-ohos \
  -p dotzuki-runner-mobile
```

The output is
`target/aarch64-unknown-linux-ohos/release/libdotzuki_runner_mobile.a`.
See the [Rust target documentation](https://doc.rust-lang.org/rustc/platform-support/openharmony.html)
for the SDK linker requirements.

## 2. Export the game

Run the export from the game project directory or pass its path:

```bash
dotzuki export --harmony . \
  --mobile-lib /path/to/libdotzuki_runner_mobile.a \
  --out dist/harmony
```

You may set `DOTZUKI_MOBILE_LIB` instead of passing `--mobile-lib`. A source
checkout also detects the library in the workspace target directory shown
above.

The exporter runs the same validation and pack rules as web and native
exports. It writes:

```text
dist/harmony/
├── AppScope/ and build-profile.json5
├── entry/src/main/ets/          # UIAbility, controls, saves
├── entry/src/main/cpp/          # Node-API, XComponent, GLES3, OHAudio
├── entry/src/main/resources/rawfile/game.dzpk
└── entry/libs/arm64-v8a/libdotzuki_runner_mobile.a
```

The editor's Play toolbar exposes the same operation as **Export HarmonyOS**.
Set `DOTZUKI_MOBILE_LIB` before starting the editor server when the library is
outside the workspace target directory.

## 3. Build and run in DevEco Studio

Open `dist/harmony` as a project. Configure an application signing profile,
select the `entry` module, and run it on an arm64 phone or tablet.

The generated shell performs these operations:

- loads `game.dzpk` with `ResourceManager`;
- restores UTF-8 save JSON from Preferences;
- advances the game from the native XComponent frame callback;
- uploads each 320×240 RGBA frame to a GLES3 texture with nearest filtering;
- combines ArkUI multi-touch buttons into the common eight-button bitmask;
- pulls 44.1 kHz stereo PCM from Rust in the OHAudio callback; and
- pauses audio and persists a stable save when the page moves to background.

## 4. Replace platform presentation without changing the game

Edit files under `entry/src/main/ets/` for control layout and lifecycle UI.
Edit `entry/src/main/cpp/dotzuki_host.cpp` for the renderer or audio adapter.
Keep `dotzuki_runner_mobile.h`, `game.dzpk`, and ABI version 1 unchanged so a
shell update does not fork game logic.

See [Mobile Architecture](../explanation/mobile-architecture.md) for the
threading and ownership contract.
