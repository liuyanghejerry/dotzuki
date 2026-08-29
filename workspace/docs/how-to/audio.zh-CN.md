# 音频制作指南

> 本文是 `how-to/audio.md` 的中文翻译，同步至引擎版本 v0.1.0（源文档 commit 3133fb419ae3bc6e5c08bbbcd43ac7fa0289e44f）。
> 内容以英文源为准；发现不一致请更新英文源再同步翻译。

> - **Audience**: game authors
> - **Type**: how-to
> - **Status**: active
> - **Last verified**: v0.1.0

声明式 JSON 音轨文件描述四个 GB 硬件通道的音乐与 SFX；22 条命令清单见
[音频命令参考](../reference/audio-commands.md)。

## 开始前

阅读[音频命令参考](../reference/audio-commands.md)，了解下文用到的命令词汇。

`dotzuki run` 从 `<dataRoot>/audio/` 下的声明式 **JSON 音轨文件**播放音乐与音效。没有
需要编译成的二进制音频格式：一条音轨就是一个 `TrackDef` 文档，描述四个 Game Boy 硬件
通道中哪些通道播放哪些命令，运行时音序器直接播放它。

运行时背后是 `dotzuki-audio`：一个游戏无关的 GB-APU 仿真加上音序器，外加逐帧管理器
（音乐淡出、主音量、跨曲目断点续播）与运行时实际出声的设备输出胶水（原生 cpal、浏
览器 Web Audio，均为默认关闭的 crate feature）。权威 schema 见
`crates/dotzuki-audio/src/format.rs`。

## 目录布局

音轨可以放在 `<dataRoot>/audio/` 下的任意位置（递归加载——下面 `music/` + `sfx/` 的划
分是惯例而非规则）：

```
data/audio/
├── music/
│   └── town.json          # {"id": "town", "kind": "music", ...}
└── sfx/
    └── confirm.json       # {"id": "confirm", "kind": "sfx", ...}
```

**`id`** 字段是稳定标识符：场景代码通过 `id` 引用音轨（例如 `playMusic("town")`、
`playSound("confirm")`），而不是文件名。

**音频完全是可选的。** 没有 `data/audio/` 的项目也能正常运行：每条音频命令都是静默的
空操作。在没有输出设备的主机上（CI、无头模式），运行时会记录一条警告并保持静默；
`--headless` 从不打开设备。

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

| 字段 | 类型 | 含义 |
|---|---|---|
| `id` | string | 场景引用的稳定标识符（必填） |
| `kind` | `"music"` \| `"sfx"` | 音乐按 `tempo` 在通道 1–4 上播放；SFX 在自己的通道上以固定速度播放 |
| `name` | string，可选 | 可读的显示名称 |
| `tempo` | integer | 8.8 定点数速度（`256` = 1.0）；仅限音乐 |
| `channels` | array | 每个已使用的硬件通道一条 |

### 通道（`ChannelDef`）

| 字段 | 类型 | 含义 |
|---|---|---|
| `hw` | `"pulse1"` \| `"pulse2"` \| `"wave"` \| `"noise"` | 目标硬件通道 |
| `commands` | `AudioCommand` 数组 | 该通道的命令列表 |

### 命令（`AudioCommand`）

命令以内部标签形式序列化：`{"type": "<name>", ...}`。这与引擎的字节码通道命令一一对
应。带字段语义的完整 22 条命令表见[音频命令参考](../reference/audio-commands.md)。

## 从场景播放音轨

场景代码通过 `game` 运行时 API 控制音频（在 `.scene` 中可通过裸命令、`@command(...)`
或 `@run { ... }`）：

| 调用 | 效果 |
|---|---|
| `playMusic("id")` | 开始播放一条音乐音轨；重复请求当前音轨是空操作（每次进入地图不会重启 BGM） |
| `playSound("id")` | 播放一次 SFX |
| `stopMusic()` | 停止当前音乐 |
| `fadeOutMusic()` | 把主音量从 7 渐弱到 0（约 1.2 秒）然后停止 |

音乐按音轨 id **去重**——用当前正在播放的 id 调用 `playMusic` 不会重启歌曲。渐弱每
10 个视频帧把主音量降低一档，然后切断音轨。

## 文件音频（WAV / OGG / FLAC / MP3）——可选

除了 JSON `TrackDef` 芯片音乐，运行时还可以播放**真实的音频文件**（WAV、OGG-Vorbis、
FLAC、MP3），通过引擎的现代混音器流式播放，支持音量/声像/淡入淡出、BGM/SFX 混音总
线以及每总线 DSP（lowpass、混响）。

这是**构建期的可选能力**：运行时必须用 `modern-audio` feature 编译（游戏在
`dotzuki-runner` / `dotzuki-web` 依赖上启用）。没有该 feature 时，音频文件会被忽略，
文件音轨命令保持静默空操作——不编译任何代码，也不构建解码器依赖。

### 目录布局

音频文件可以放在 `<dataRoot>/audio/` 下的任意位置，与 JSON 音轨并存（递归加载）：

```
data/audio/
├── music/
│   ├── town.json          # 芯片音乐 TrackDef（优先查找）
│   └── field.ogg          # 流式文件音轨
└── sfx/
    ├── confirm.json
    └── hit.wav
```

文件音轨的 **id** 是它相对 `audio/` 的路径去掉扩展名：
`data/audio/music/field.ogg` → `playMusic("music/field")`。

### 语义

- 文件 BGM 音轨**循环**播放；与 JSON 音轨一样按 id 去重（重复请求正在播放的 id 是空
  操作），被替换时交叉淡出（`fadeOutMusic` 约 1.2 秒渐弱）。
- 文件 SFX 音轨在 SFX 总线上播放一次。
- 与文件音轨同 id 的 JSON `TrackDef` **优先**——JSON 总是先查找。
- 文件 BGM 与芯片音乐可以同时播放（在输出中混合）；`stopMusic` / `fadeOutMusic`
  停止当前正在播放的那一种。
- 文件是**流式**的：压缩字节驻留内存，PCM 按块解码——长 OGG 不会占用完整解码后的
  内存。

## 编写要点

- 音乐为四个 GB 通道而写；真实的 GB 音乐从 `pulse1` 起连续使用通道，通道流按 `hw` 索
  引编码（未使用的内部空位留空，末尾的空位被裁掉）。
- `pitch` 是当前八度内的一个半音 0–11——文件格式中没有音符名语法；更高级的便利功能
  （音符名、音量/渐弱拆分）属于编辑器的 Audio 活动，不属于文件。
- 同一个 `id` 不得在多个音轨文件中重复（库以 id 为键）。
