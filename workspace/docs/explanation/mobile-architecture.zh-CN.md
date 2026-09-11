# 移动端架构

> 本文是 `mobile-architecture.md` 的中文翻译，同步至引擎版本 v0.6.0
>（源文档 commit ca430506b34b）。
> 内容以英文源为准；发现不一致请更新英文源再同步翻译。

> - **Audience**: rust developers, engine contributors
> - **Type**: explanation
> - **Status**: active
> - **Last verified**: v0.6.0

本文解释 dotzuki 为何采用一套 Rust 运行时契约和三个原生移动外壳，
以及鸿蒙外壳
如何沿用 iOS 的职责划分。

## 决策

[`mobile runtime`](../reference/glossary.md#engine)（移动运行时）是共用的游戏边界。
每个 [`mobile shell`](../reference/glossary.md#engine)（移动外壳）负责操作系统
要求的 API：

```text
零 Rust 项目 -> game.dzpk -> dotzuki-runner-mobile
                                  |
                  C ABI：帧 / RGBA / PCM / 存档 / 输入
                  /               |                 \
           iOS 外壳          Android 外壳          鸿蒙外壳
       Metal + Swift 音频    Surface + 平台音频   XComponent + GLES3
       SwiftUI/UIKit 生命周期 Kotlin 生命周期       ArkTS + OHAudio
```

Rust 侧加载项目数据、推进 `RunnerGame`、渲染 320×240 RGBA 帧、生成交错
双声道 PCM，并序列化存档。外壳控制显示时钟、纹理呈现、触摸输入、
音频回调、应用生命周期和私有存储。

这个划分保留了现有 iOS 实现最有价值的性质：Swift 负责全部
Apple framework，Rust 通过窄 C 接口导出数据和状态。鸿蒙用 ArkTS、
Node-API、XComponent、EGL/GLES3 和 OHAudio 实现同样的划分。

## 为什么不把 Android 窗口循环作为公共边界

现有 Android 移植把 `winit`、`pixels` 和 native activity 循环放在 Rust 内部。这个
方案提供了可运行的窗口路径，但平台功能通过各自的 Kotlin overlay
和回调进入，音频、存档和生命周期因而跨越不同边界。

如果鸿蒙复用该循环，引擎还会绑定一个窗口适配器，同时仍需用 ArkTS bridge
接入移动服务。公共 C ABI 把窗口框架留在 `dotzuki-runner` 之外，
并向三端提供相同的帧、输入、音频和持久化契约。

## 契约

`dotzuki-runner-mobile/include/dotzuki_runner_mobile.h` 定义 ABI 版本 1。
契约包含以下几组能力：

| 分组 | 调用 | 所有权 |
|---|---|---|
| 生命周期 | `create`、`destroy`、`abi_version`、`last_error` | 外壳传入会被复制的 `.dzpk` buffer |
| 帧循环 | `tick`、`width`、`height`、`frame_len`、`copy_frame` | 游戏线程推进并复制 RGBA |
| 输入 | `tick` 的 bitmask | A、B、Select、Start、Right、Left、Up、Down 使用 bit 0–7 |
| 音频 | `audio_fill` | 一个实时消费者按 44.1 kHz 拉取双声道 PCM |
| 持久化 | `export_save`、`import_save` | 外壳把 UTF-8 JSON 存入平台私有存储 |

游戏线程独占帧和存档操作。一个音频回调可同时调用 `audio_fill`。
无锁的单生产者、单消费者 ring buffer 隔离游戏循环和音频回调。

移动宿主设置 `RunnerOptions::external_saves`。这会禁止磁盘加载与写入，
包括 Start 菜单里的 Save 命令。外壳在启动时导入存档，
并在稳定状态导出存档。

## 平台映射

| 关注点 | iOS | Android 目标 | 鸿蒙 |
|---|---|---|---|
| 帧时钟 | `CADisplayLink` | `Choreographer` | XComponent 原生帧回调 |
| surface | `MTKView` / Metal | `SurfaceView` 或 `TextureView` | `XComponent` / `NativeWindow` |
| 像素 | Metal 纹理上传 | GLES/Vulkan 纹理上传 | EGL/GLES3 纹理上传 |
| 音频 | `AVAudioEngine` 回调 | AAudio/Oboe 回调 | OHAudio renderer 回调 |
| 生命周期 | UIKit/SwiftUI | Activity | `UIAbility` 与页面生命周期 |
| 存档 | app container | app 私有文件 | Preferences |

鸿蒙导出器实现了最右列。现有 iOS 外壳已通过游戏专用 ABI 采用同样的
所有权模式。
Android 和 iOS 可以迁移到 ABI 版本 1，而不需要改变 `RunnerGame` 或项目 pack。

## 兼容边界

外壳依靠 `dotzuki_mobile_abi_version()` 判断契约版本。项目 pack 与平台无关。
存档兼容仍由 `SAVE_VERSION` 管理，不由外壳或 C ABI 版本管理。

Rust 编译器把鸿蒙 target 列为带 host tools 的 Tier 2 target，但仍需配置 OpenHarmony
SDK linker。华为 NDK 样例定义了生成外壳所采用的 XComponent 和 OHAudio 接法：

- [Rust 鸿蒙 target 支持](https://doc.rust-lang.org/rustc/platform-support/openharmony.html)
- [华为 NDK XComponent 样例](https://gitee.com/harmonyos_samples/ndk-xcomponent)
- [华为 Node-API 指南](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/napi-introduction-V5)
