# dotzuki CLI 参考

> 本文是 `reference/cli.md` 的中文翻译，同步至引擎版本 v0.6.0
>（源文档 commit ca430506b34b）。
> 内容以英文源为准；发现不一致请更新英文源再同步翻译。

> - **Audience**: game authors, CI
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.6.0

用于生成骨架、校验和运行零 Rust 游戏项目的每个 `dotzuki` 子命令、flag 和退出
码。

`dotzuki` 二进制（`crates/dotzuki-cli`）生成骨架、校验并运行**零 Rust 游戏
项目**——包含 DSL、数据和资产的普通目录，外加一份 `.dotzuki-editor.json`
项目清单（见[项目清单](project-manifest.md)）。

从 workspace 根目录构建：

```bash
cd workspace
cargo build --release --bin dotzuki
```

产物是 `target/release/dotzuki`。所有命令都接收一个项目路径；定义项目布局的
是项目清单，不是 CLI。

## 子命令

| 命令 | 用途 |
|---|---|
| `dotzuki new <name>` | 生成一个新的游戏项目骨架（布局与编辑器的空模板一致） |
| `dotzuki check <dir>` | 编译项目中的每个 DSL 文件并报告诊断信息；出错时退出码为 1。有 `battle` 区块时还会校验它 |
| `dotzuki run <dir>` | 启动项目并在窗口中游玩（或为 CI/截图以无头模式运行） |
| `dotzuki export --web <dir>` | 把项目导出为静态网站 |
| `dotzuki export --native <dir>` | 把项目导出为原生应用目录 |
| `dotzuki export --harmony <dir>` | 导出鸿蒙 DevEco Studio 工程（移动运行时 + 游戏 pack） |

## `dotzuki new <name>`

生成一个新的项目骨架。`name` 必须是 slug：`[a-z0-9][a-z0-9-]*`。

| Flag | 默认值 | 含义 |
|---|---|---|
| `--dir <parent>` | 当前目录 | 新项目创建于其中的父目录 |
| `--title <name>` | 该 slug | 存入项目清单根 `name` 字段的显示名 |
| `--template <name>` | `empty` | 项目模板：`empty`（编辑器的空布局）或 `your-first-game`（[教程](../tutorials/your-first-game.md)中的教程项目，内嵌于 CLI） |

生成的布局：`.dotzuki-editor.json` + `data/`（maps、tiles、
stories/characters/quests/arcs）、`gfx/`、`assets/scenes/main.scene`、README
——编辑器的七个活动（maps / scripts / play / data / story / assets / tiles）。
`--template your-first-game` 改为写出完整教程项目——城镇、空地、脚本战斗、
随机遇敌与存档——并把项目名代入其清单。

```bash
dotzuki new my-game --dir ~/projects --title "My Game"
dotzuki new my-game --dir ~/projects --template your-first-game
cd ~/projects/my-game
```

## `dotzuki check <dir>`

在内存中编译所有发现的 DSL 文件（`.scene` / `.gui` / `.theme` / `.style`）并
报告诊断信息；任何文件失败即退出码非零。项目清单带 `battle` 区块时还会校验：

- 引用的表 id 存在于 `data` 活动中；
- `stats` / `skills` / `items` / `encounters` 字段名存在于表 schema 中；
- `rules` 文件能解析并通过 `validate_ruleset`（未知的事件、op、属性、类型和
  资源都是加载时错误）。

```bash
dotzuki check .
```

## `dotzuki run <dir>`

启动项目。默认为一个 320×240（可缩放）的窗口游戏循环。

| Flag | 默认值 | 含义 |
|---|---|---|
| `--map <id>` | 项目清单 `game.entryMap` | 出生所在的地图（覆盖项目清单） |
| `--lang <en\|zh>` | `en` | UI / 脚本语言（`@t` 双语文本据此选择） |
| `--headless` | off | 无窗口运行——用于 smoke 测试和截图 |
| `--frames <n>` | `120` | 无头模式：要模拟的帧数 |
| `--screenshot <file.png>` | — | 无头模式：把最后一帧导出为 PNG |
| `--save` | off | 无头模式：也写入存档文件（窗口模式运行总是存档） |
| `--save-file <path>` | `<project>/.dotzuki-save.json` | 存档文件位置 |
| `--fresh` | off | 忽略已有存档文件，从头开始 |
| `--watch` | off | 文件变化时热重载场景和当前地图。**仅窗口模式**——与 `--headless` 一起时被忽略 |
| `--scale <n>` | `3` | 窗口缩放倍率 |

示例：

```bash
# Play a project
dotzuki run .

# CI smoke test: boot 60 frames headless, no window, no save
dotzuki run . --headless --frames 60

# Headless screenshot for previews
dotzuki run . --headless --map TownSquare --screenshot shot.png

# Iterate with hot reload
dotzuki run . --watch
```

## `dotzuki export --harmony <dir>`

把项目打包为鸿蒙 DevEco Studio 应用。应用通过 ABI 版本 1 使用
`dotzuki-runner-mobile`，并携带与其他导出 target 相同的 `game.dzpk`。

| Flag | 默认值 | 含义 |
|---|---|---|
| `--out <dir>` | `<project>/dist/harmony` | DevEco Studio 工程输出目录 |
| `--mobile-lib <path>` | workspace target 或 `DOTZUKI_MOBILE_LIB` | 预构建的 arm64 鸿蒙 `libdotzuki_runner_mobile.a` |
| `--force` | off | 即使校验报告诊断信息也导出 |

导出器不会调用鸿蒙 Rust 工具链。请先构建静态库，再传入路径：

```bash
dotzuki export --harmony . \
  --mobile-lib target/aarch64-unknown-linux-ohos/release/libdotzuki_runner_mobile.a
```

输出包括 ArkTS 生命周期和控制器、XComponent GLES3 renderer、OHAudio 输出、
Preferences 存档、C ABI header、静态库和 `game.dzpk`。参见
[鸿蒙导出指南](../how-to/export-harmonyos.zh-CN.md)。

## 退出码

- `dotzuki check`：`0` = 所有 DSL 编译通过（且 `battle` 区块校验通过）；`1` =
  发现诊断信息。
- `dotzuki run`：`0` = 正常退出。
- `dotzuki export --harmony`：`0` = 已写出 DevEco Studio 工程；`1` = 校验失败、
  项目超过 pack 限制，或移动运行时 library 不可用。

## 说明

- 存档文件带版本号（`.dotzuki-save.json`）；`--fresh` 从头开始，不动该文件。
- 无头模式运行会模拟完整的帧循环，包括场景 / 战斗分发，因此 `--screenshot`
  的输出反映真实的渲染状态。
- 编辑器的 Play 活动通过 WASM（`dotzuki-runner-web`）使用同一个运行器，而不
  是这个 CLI。
