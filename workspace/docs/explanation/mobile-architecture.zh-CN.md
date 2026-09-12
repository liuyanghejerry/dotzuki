# 移动端架构

> 本文是 `mobile-architecture.md` 的中文翻译，同步至引擎版本 v0.6.1
>（源文档 commit d7ec8535d65415c69ae1be28d20c157ad1c19699）。
> 内容以英文源为准；发现不一致请更新英文源再同步翻译。

> - **Audience**: rust developers, engine contributors
> - **Type**: explanation
> - **Status**: active
> - **Last verified**: v0.6.1

本文解释 dotzuki 为何采用一套 Rust 运行时契约，并为每个移动平台提供原生
外壳；Android 和鸿蒙使用同一套带版本号的 C ABI。

## 决策

[`mobile runtime`](../reference/glossary.md#engine)（移动运行时）是共用的游戏边界。
每个 [`mobile shell`](../reference/glossary.md#engine)（移动外壳）负责操作系统
要求的 API：

```text
零 Rust 项目 -> game.dzpk -> dotzuki-runner-mobile
                                  |
                  C ABI：帧 / RGBA / PCM / 存档 / 输入
                  /               |                 \
           iOS 外壳             Android 外壳          鸿蒙外壳
       Metal + Swift 音频   SurfaceView + AudioTrack  XComponent + GLES3
       SwiftUI/UIKit 生命周期    Kotlin Activity        ArkTS + OHAudio
```

Rust 侧加载项目数据、推进 `RunnerGame`、渲染 320×240 RGBA 帧、生成交错
双声道 PCM，并序列化存档。外壳控制显示时钟、纹理呈现、触摸输入、
音频回调、应用生命周期和私有存储。

这个划分沿用现有 iOS 的所有权模型：Swift 负责 Apple framework，Rust 通过
窄 C 接口导出数据和状态。Android 和鸿蒙分别通过自己的原生 UI、显示、音频、
生命周期与存储 API 实现相同的划分。

## 为什么 Android 窗口循环由外壳负责

早期的游戏专用 Android 移植把 `winit`、`pixels` 和 native activity 循环放在
Rust 内部，平台能力则从独立的 Kotlin overlay 和回调进入。共用 Android 外壳
现在负责 Activity、`Choreographer`、`SurfaceView`、`AudioTrack`、触摸控制和
`SharedPreferences`。Rust 保持在与鸿蒙相同的帧、输入、音频和持久化契约之后。

## 契约

`dotzuki-mobile/include/dotzuki_runner_mobile.h` 定义 ABI 版本 1。
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

| 关注点 | iOS | Android | 鸿蒙 |
|---|---|---|---|
| 帧时钟 | `CADisplayLink` | `Choreographer` | XComponent 原生帧回调 |
| surface | `MTKView` / Metal | `SurfaceView` / Canvas | `XComponent` / `NativeWindow` |
| 像素 | Metal 纹理上传 | 最近邻 bitmap 复制 | EGL/GLES3 纹理上传 |
| 音频 | `AVAudioEngine` 回调 | `AudioTrack` stream | OHAudio renderer 回调 |
| 生命周期 | UIKit/SwiftUI | Activity | `UIAbility` 与页面生命周期 |
| 存档 | app container | `SharedPreferences` | Preferences |

Android 和鸿蒙导出器通过 ABI 版本 1 实现各自列出的能力。现有 iOS 外壳通过
游戏专用 ABI 沿用同一所有权模式，迁移时不需要改变 `RunnerGame` 或项目 pack。

## 兼容边界

外壳依靠 `dotzuki_mobile_abi_version()` 判断契约版本。项目 pack 与平台无关。
存档兼容仍由 `SAVE_VERSION` 管理，不由外壳或 C ABI 版本管理。

Rust 编译器把鸿蒙 target 列为带 host tools 的 Tier 2 target，但仍需配置 OpenHarmony
SDK linker。华为 NDK 样例定义了生成外壳所采用的 XComponent 和 OHAudio 接法：

- [Rust 鸿蒙 target 支持](https://doc.rust-lang.org/rustc/platform-support/openharmony.html)
- [华为 NDK XComponent 样例](https://gitee.com/harmonyos_samples/ndk-xcomponent)
- [华为 Node-API 指南](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/napi-introduction-V5)

## 自定义 Rust 游戏

`dotzuki-mobile` 提供 `MobileGame`、不透明运行时、PCM 队列和
`export_mobile_abi!`，不依赖具体游戏、渲染器或设备后端。
`dotzuki-runner-mobile` 只负责 `RunnerGame` 和 `.dzpk` 的适配。
自定义 Rust 游戏实现同一接口并导出自己的工厂；每个应用只链接一个工厂。
工厂定义初始化字节和存档 JSON；宿主从运行时查询画面尺寸。

公共 Android 和鸿蒙宿主使用单调时钟按 59.7275 Hz 推进游戏、最近邻采样、
独立触控区和 44.1 kHz PCM。它们每 500 ms 检查已提交存档，并在生命周期切换时
刷新。游戏决定何时提交存档。持久化是异步的；如果刷新完成前进程被终止，
最近一次提交可能丢失。销毁运行时前必须停止音频回调。

自定义静态库可通过 `scripts/export-mobile-host.py --help` 查看宿主导出参数，
无需经过零 Rust 项目校验和打包。输出目录必须为空。游戏的构建脚本只提供库、
初始化字节、名称和包标识，平台源代码仍在引擎仓库维护。
