# Export a Game for Android

> - **Audience**: game authors, engine contributors
> - **Type**: how-to
> - **Status**: active
> - **Last verified**: v0.6.1

Build the shared mobile runtime and export a zero-Rust game as an Android
Studio project for arm64 phones and tablets.

Install Android Studio with Android SDK 35, CMake 3.22.1, NDK 27, and JDK 17.
The generated app supports Android 8.0 (API 26) and later.

## 1. Build the Rust mobile runtime

Install the Rust target:

```bash
rustup target add aarch64-linux-android
```

Point Cargo at the NDK compiler, then build from `workspace/`. Replace
`$ANDROID_NDK_HOME` with your NDK directory when that variable is unset.

```bash
export NDK_BIN="$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/darwin-x86_64/bin"
export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$NDK_BIN/aarch64-linux-android26-clang"
export AR_aarch64_linux_android="$NDK_BIN/llvm-ar"
cargo build --release \
  --target aarch64-linux-android \
  -p dotzuki-runner-mobile
```

Use `linux-x86_64` instead of `darwin-x86_64` on Linux. The output is
`target/aarch64-linux-android/release/libdotzuki_runner_mobile.a`.

## 2. Export the game

Run the export from the game project directory or pass its path:

```bash
dotzuki export --android . \
  --mobile-lib /path/to/libdotzuki_runner_mobile.a \
  --out dist/android
```

You may set `DOTZUKI_ANDROID_MOBILE_LIB` instead of passing `--mobile-lib`.
`DOTZUKI_MOBILE_LIB` remains a common fallback for mobile export scripts. A
source checkout also detects the static library in the workspace target
directory shown above.

The exporter validates the project and writes:

```text
dist/android/
├── settings.gradle.kts and build.gradle.kts
└── app/
    ├── src/main/java/com/dotzuki/player/  # lifecycle, frame clock, audio, controls
    ├── src/main/cpp/                      # JNI bridge and C ABI header
    ├── src/main/res/raw/game.dzpk
    └── src/main/jniLibs/arm64-v8a/libdotzuki_runner_mobile.a
```

The editor's Play toolbar exposes the same operation as **Export Android**.
Release installers already contain the arm64 runtime library.

## 3. Build and run in Android Studio

Open `dist/android`, let Gradle sync, select the `app` configuration, and run
it on an arm64 emulator or device. For a command-line build, use Gradle 8.9:

```bash
gradle --project-dir dist/android assembleDebug
```

The APK is written under `dist/android/app/build/outputs/apk/debug/`.

The generated shell performs these operations:

- loads `game.dzpk` from Android resources;
- restores UTF-8 save JSON from `SharedPreferences`;
- advances the fixed-step game loop from `Choreographer`;
- scales each RGBA frame onto a `SurfaceView` with nearest sampling;
- combines multi-touch controls into the common eight-button bitmask;
- pulls 44.1 kHz stereo floating-point PCM into `AudioTrack`; and
- stops audio and persists a committed save before the activity is destroyed.

## 4. Customize the Android presentation

Edit the Kotlin files under `app/src/main/java/com/dotzuki/player/` to change
the controls or activity layout. Keep the C ABI header, `game.dzpk`, and ABI
version 1 unchanged so platform changes remain independent of game logic.

See [Mobile Architecture](../explanation/mobile-architecture.md) for the
threading and ownership contract.
