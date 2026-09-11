# 导出鸿蒙游戏

> 本文是 `export-harmonyos.md` 的中文翻译，同步至引擎版本 v0.6.0
>（源文档 commit ca430506b34b）。
> 内容以英文源为准；发现不一致请更新英文源再同步翻译。

> - **Audience**: game authors, engine contributors
> - **Type**: how-to
> - **Status**: active
> - **Last verified**: v0.6.0

构建公共移动运行时，并把零 Rust 游戏导出为 DevEco Studio 鸿蒙工程。

开始前，请阅读[发布与升级](./publishing.zh-CN.md)，并安装带 HarmonyOS SDK 5.0.5
（API 17）或兼容新版本 SDK 的 DevEco Studio。

## 1. 构建 Rust 移动运行时

安装 Rust 的鸿蒙 target：

```bash
rustup target add aarch64-unknown-linux-ohos
```

把 Cargo 的 target linker 指向 OpenHarmony SDK 的 Clang wrapper。wrapper 路径取决于
SDK 安装位置。然后从 `workspace/` 构建静态库：

```bash
export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_OHOS_LINKER=/path/to/ohos-clang-wrapper
cargo build --release \
  --target aarch64-unknown-linux-ohos \
  -p dotzuki-runner-mobile
```

输出文件是
`target/aarch64-unknown-linux-ohos/release/libdotzuki_runner_mobile.a`。
SDK linker 要求见
[Rust target 文档](https://doc.rust-lang.org/rustc/platform-support/openharmony.html)。

## 2. 导出游戏

从游戏项目目录执行导出，也可以传入项目路径：

```bash
dotzuki export --harmony . \
  --mobile-lib /path/to/libdotzuki_runner_mobile.a \
  --out dist/harmony
```

也可以设置 `DOTZUKI_MOBILE_LIB`，不传 `--mobile-lib`。源码 checkout 还会检测上文
workspace target 目录中的 library。

导出器运行与 Web、原生导出相同的验证和 pack 规则，并写出：

```text
dist/harmony/
├── AppScope/ and build-profile.json5
├── entry/src/main/ets/          # UIAbility、控制器、存档
├── entry/src/main/cpp/          # Node-API、XComponent、GLES3、OHAudio
├── entry/src/main/resources/rawfile/game.dzpk
└── entry/libs/arm64-v8a/libdotzuki_runner_mobile.a
```

编辑器的 Play 工具栏通过 **Export HarmonyOS** 执行同一操作。如果 library 不在
workspace target 目录中，请在启动编辑器 server 前设置 `DOTZUKI_MOBILE_LIB`。

## 3. 在 DevEco Studio 构建和运行

把 `dist/harmony` 作为工程打开。配置应用签名，选择 `entry` module，然后在 arm64
手机或平板上运行。

生成的外壳执行以下操作：

- 用 `ResourceManager` 加载 `game.dzpk`；
- 从 Preferences 恢复 UTF-8 存档 JSON；
- 由 XComponent 原生帧回调推进游戏；
- 用 nearest filtering 把每个 320×240 RGBA 帧上传到 GLES3 纹理；
- 把 ArkUI 多点触摸按键组合成公共八键 bitmask；
- 在 OHAudio 回调中从 Rust 拉取 44.1 kHz 双声道 PCM；
- 页面进入后台时暂停音频并持久化稳定存档。

## 4. 替换平台表现而不改游戏

在 `entry/src/main/ets/` 下修改控制器布局和生命周期 UI。在
`entry/src/main/cpp/dotzuki_host.cpp` 中修改 renderer 或 audio adapter。保持
`dotzuki_runner_mobile.h`、`game.dzpk` 和 ABI 版本 1 不变，
外壳升级就不会分叉游戏逻辑。

线程与所有权契约见[移动端架构](../explanation/mobile-architecture.zh-CN.md)。
