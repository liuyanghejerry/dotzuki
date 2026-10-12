# 导出 Android 游戏

> 本文是 `export-android.md` 的中文翻译，同步至引擎版本 v0.9.0
>（源文档 commit efb964354f9b772479ed26a7811cfa432c7d0a87）。
> 内容以英文源为准；发现不一致请更新英文源再同步翻译。

> - **Audience**: game authors, engine contributors
> - **Type**: how-to
> - **Status**: active
> - **Last verified**: v0.9.0

构建共用移动运行时，并把零 Rust 游戏导出为面向 arm64 手机和平板的
Android Studio 工程。

开始前，请阅读[发布与升级](./publishing.zh-CN.md)，并安装 Android Studio、
Android SDK 35、CMake 3.22.1、NDK 27 和 JDK 17。生成的应用支持 Android
8.0（API 26）及更高版本。

## 1. 构建 Rust 移动运行时

安装 Rust target：

```bash
rustup target add aarch64-linux-android
```

让 Cargo 使用 NDK 编译器，然后从 `workspace/` 构建。如果没有设置
`$ANDROID_NDK_HOME`，请把它替换为 NDK 目录。

```bash
export NDK_BIN="$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/darwin-x86_64/bin"
export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$NDK_BIN/aarch64-linux-android26-clang"
export AR_aarch64_linux_android="$NDK_BIN/llvm-ar"
cargo build --release \
  --target aarch64-linux-android \
  -p dotzuki-runner-mobile
```

Linux 上请用 `linux-x86_64` 替换 `darwin-x86_64`。输出文件是
`target/aarch64-linux-android/release/libdotzuki_runner_mobile.a`。

## 2. 导出游戏

从游戏项目目录执行导出，也可以传入项目路径：

```bash
dotzuki export --android . \
  --mobile-lib /path/to/libdotzuki_runner_mobile.a \
  --out dist/android
```

也可以设置 `DOTZUKI_ANDROID_MOBILE_LIB`，不传 `--mobile-lib`。
`DOTZUKI_MOBILE_LIB` 仍是移动端导出脚本的共用后备变量。源码 checkout
还会检测上文 workspace target 目录中的静态库。

导出器校验项目并写出：

```text
dist/android/
├── settings.gradle.kts and build.gradle.kts
└── app/
    ├── src/main/java/com/dotzuki/player/  # 生命周期、帧时钟、音频、控制器
    ├── src/main/cpp/                      # JNI bridge 和 C ABI header
    ├── src/main/res/raw/game.dzpk
    └── src/main/jniLibs/arm64-v8a/libdotzuki_runner_mobile.a
```

编辑器的 Play 工具栏通过 **Export Android** 执行同一操作。发布安装包中已包含
arm64 运行时静态库。

## 3. 在 Android Studio 构建和运行

打开 `dist/android`，等待 Gradle 同步，选择 `app` 配置，然后在 arm64 模拟器或
设备上运行。命令行构建请使用 Gradle 8.9：

```bash
gradle --project-dir dist/android assembleDebug
```

APK 会写入 `dist/android/app/build/outputs/apk/debug/`。

生成的外壳执行以下操作：

- 从 Android resource 加载 `game.dzpk`；
- 从 `SharedPreferences` 恢复 UTF-8 存档 JSON；
- 由 `Choreographer` 推进定步长游戏循环；
- 通过最近邻采样把每个 RGBA 帧缩放到 `SurfaceView`；
- 把多点触摸控制组合成共用的八键 bitmask；
- 通过 `AudioTrack` 拉取 44.1 kHz 浮点双声道 PCM；
- 销毁 Activity 前停止音频并持久化已提交的存档。

## 4. 自定义 Android 表现

修改 `app/src/main/java/com/dotzuki/player/` 下的 Kotlin 文件，可以调整控制器或
Activity 布局。保持 C ABI header、`game.dzpk` 和 ABI 版本 1 不变，平台变更就能
与游戏逻辑保持独立。

线程和所有权契约见[移动端架构](../explanation/mobile-architecture.zh-CN.md)。

## 横屏触控布局

导出的外壳支持正反横屏，游戏画面保持比例。方向盘位于左下，A/B 位于右下，
Start/Select 位于右上，所有控件避让窗口安全区。
点击左上齿轮可调整大小、向内/垂直位置、不透明度、左右交换、浮动方向盘和触觉反馈。
设置保存在设备上，不改变游戏存档；编辑时游戏暂停。

方向盘支持不抬指换向，方向与 A/B 可同时按住。系统打断、窗口变化和取消事件会释放输入。
重新导出会更新生成的外壳源文件；保留自行修改的宿主代码后再替换。
实现与 iOS 接入见[共享触控控制器](../../crates/dotzuki-mobile/controls/README.zh-CN.md)。
