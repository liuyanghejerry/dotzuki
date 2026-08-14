# 发布与升级指南

> 本文是 `how-to/publishing.md` 的中文翻译，同步至引擎版本 v0.1.0（源文档 commit 3133fb419ae3bc6e5c08bbbcd43ac7fa0289e44f）。
> 内容以英文源为准；发现不一致请更新英文源再同步翻译。

> - **Audience**: game authors, CI
> - **Type**: how-to
> - **Status**: active
> - **Last verified**: v0.1.0

打包、发布并升级一个零 Rust 项目。

如何打包、发布并升级用 dotzuki 构建的**零 Rust 项目**。本文与
[项目清单与项目结构](../reference/project-manifest.md)（项目契约）和
[CLI 参考](../reference/cli.md)（工具链）互补。

## 游戏项目是什么

游戏项目就是一个**普通目录**——`.dotzuki-editor.json` + `data/` + `gfx/` + `assets/`
（场景）。没有构建步骤：`dotzuki` 可执行文件（或编辑器）原样消费这个目录。发布一个
游戏 = 发布这个目录加上一种运行它的方式。

## 1. 交付项目目录

没有编译/打包阶段。把整个项目目录（排除 `*.bak`、点文件与任何编辑器状态）复制到目
标机器上，然后运行：

```bash
dotzuki run <project-dir>
```

交付检查清单：

- 在最终目录树上运行 [`dotzuki check`](../reference/cli.md)——干净退出是唯一存在的构
  建检查。
- 项目隐式携带自身的 `dotzuki` 版本要求：用引擎版本与项目开发时所用版本一致的
  `dotzuki` 可执行文件来运行它。项目清单里没有按项目固定的版本。
- 存档文件默认写入 `<project>/.dotzuki-save.json`——交付可写的目录，或者对只读安装
  用 `--save-file` 指向别处。

## 2. 自动化冒烟测试（CI）

```bash
dotzuki run . --headless --frames 60          # boot, no window, no save
dotzuki run . --headless --map StartTown --screenshot shot.png --save
```

`--headless` 从不打开音频设备或窗口；`--screenshot` 输出真实渲染的最后一帧。见
[`CLI_REFERENCE.md`](../reference/cli.md)。

## 3. 网页中的可玩演示（WASM）

同一个运行器编译为 WASM（`dotzuki-runner-web`），并基于**内存文件系统**启动——编辑器
的 Play 活动走的正是这条路径，所以在编辑器里能玩的项目在网页里也能一模一样地玩。

编辑器把项目打包为

```
{ "<posix rel path>": "<base64>" }   // whole project, incl. .dotzuki-editor.json
```

（排除 `node_modules`/`.git`/`target`/`dist`、点文件与 `*.bak`；单文件上限 16 MB，总
量 64 MB）。随后页面驱动：

| `WasmRunner` 方法 | 用途 |
|---|---|
| `new(filesJson, saveJson?)` | 用打包的文件启动；可选地导入一份存档 |
| `tick(inputBitmask)` | 推进一帧；返回 RGBA 帧缓冲 |
| `take_audio()` | 拉取生成的立体声采样（`f32`，交错排列） |
| `width()` / `height()` | 帧尺寸（320×240） |
| `export_save()` / `import_save(json)` | 存档导出/导入（例如写入 `localStorage`） |

输入位掩码是 `dotzuki_renderer::input` 使用的 GB 按键掩码
（Up/Down/Left/Right/A/B/Start/Select）。编辑器的 `src/composables/useWasmRunner.ts`
是接线输入、音频与存档持久化的可用参考。

## 4. 升级引擎

**零 Rust 项目**——没有依赖清单；“升级”意味着使用更新的 `dotzuki` 可执行文件 / 编辑
器。升级之前：

1. 在旧工具链上运行 `dotzuki check .`——一棵干净的目录树是最安全的起点。
2. 用新可执行文件重新检查，然后启动一次并核对游戏状态。
3. 存档兼容性：存档带版本号（`.dotzuki-save.json`，`SAVE_VERSION` = 3）。
   `version <= SAVE_VERSION` 的存档可以加载；比运行中引擎**更新**的存档会被拒绝，游
   戏从头开始（文件不会被删除）。用新版本保存后再降级引擎是唯一会丢失存档的情形——
   升级期间请保留 `.dotzuki-save.json` 的备份。

**Rust 游戏仓库**（以 Cargo git 依赖方式消费引擎）：

```bash
# bump the tag in Cargo.toml, then
cargo update        # re-resolve the git dependency to the new tag
cargo build
```

升级 = bump tag + `cargo update`。见引擎 README 的 “Using the engine from a game
repo”。同样的存档版本规则适用：新引擎读取旧存档（v1/v2/v3 都能正常加载）；旧引擎拒
绝新存档。
