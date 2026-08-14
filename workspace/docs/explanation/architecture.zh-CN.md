# 架构概览

> 本文是 `explanation/architecture.md` 的中文翻译，同步至引擎版本 v0.1.0（源文档 commit 3133fb419ae3bc6e5c08bbbcd43ac7fa0289e44f）。
> 内容以英文源为准；发现不一致请更新英文源再同步翻译。

> - **Audience**: rust developers, engine contributors
> - **Type**: explanation
> - **Status**: active
> - **Last verified**: v0.1.0

引擎各 crate、运行器、CLI 与编辑器如何组合在一起，以及一个零 Rust 项目如何从 DSL
文件走到可运行的游戏。

本页取代旧版 `archive/developer-guide-legacy.md`，成为当前架构的导读。

## 分层

```
game project (zero-Rust)          editor (Vue/Vite + Play via WASM runner)
  manifest + data/ + gfx/ + assets/        │
        │                                  │
        ▼                                  ▼
 dotzuki-runner ◄───────────── dotzuki-runner-web (WASM)
        │  loads manifest/DSL/maps/collision/tilesets
        ▼
 dotzuki-engine ── dotzuki-rules ── dotzuki-engine-dsl ── dotzuki-engine-script
        │            (RON → stacks)  (.scene/.gui/.theme/.style)  (Boa JS)
        ├── dotzuki-engine-tiled (Tiled .tmx → engine types)
        ├── dotzuki-renderer (GB-style tiles/text, CJK fonts) + dotzuki-ui (Painter trait)
        ├── dotzuki-audio (GB-APU emulation + sequencer)
        └── dotzuki-app (window/loop) / dotzuki-tui (terminal) / dotzuki-web
```

- 游戏是**零 Rust** 的：引擎从不探查游戏的数据目录。Rust 游戏通过
  `compiler::compile_dirs` / `loader::register_compiled` 嵌入编译产物；零 Rust
  项目由运行器加载。
- 游戏仓库以 crates.io 依赖或 tag 固定的 git 依赖消费引擎（见仓库 `README.md`）。

## 从 DSL 到可运行的游戏

`.scene` / `.gui` / `.theme` / `.style` 文件经 `dotzuki-engine-dsl` 编译：

- `.scene` → 由 `dotzuki-engine-script`（基于 Boa）消费的 JavaScript；
  `dotzuki-engine-dsl` 还自带一个原生 AST 解释器
  （`crates/dotzuki-engine-dsl/src/interpreter.rs`），无需 JS 引擎即可执行场景，
  与 Boa 运行时协议 1:1 对应——它是场景语义的权威标准（解释器与 Boa 的取舍策略
  见 `AGENTS.md`）。
- `.gui` → 由渲染器布局引擎消费的 JSON。
- `.theme` / `.style` → JSON token/样式表文件（见
  [theme 与 style 参考](../reference/dsl/theme-style.md)）。

`dotzuki check` 在内存中编译所有内容；`dotzuki run` 用编译好的项目启动运行器。

## 战斗 = 效果栈

实时战斗回合经由 `dotzuki_engine::battle::stack::StackDriver` 运行：事件、效果与
处理器构成一个栈，`dotzuki-rules` 把声明式的 `rules.ron` 编译成这些运行时栈。该
模型及其 RNG 确定性的理由见[效果栈页面](effect-stack.md)；编写方式见[战斗规则指南](../how-to/battles.md)。

## Provider 模式

游戏数据通过 `GameData` trait 到达引擎。所有标识符类型（Map、Item、Species 等）
都是该 trait 上的泛型关联类型，因此引擎 crate 中没有任何具体游戏数据，也没有平台
调用（`dotzuki-engine` 中没有 I/O、GPU 或窗口）。

## 职责对照表

| 关注点 | Crate | 文档页面 |
|---|---|---|
| 战斗栈 + 核心类型 | `dotzuki-engine` | [效果栈](effect-stack.md) |
| 战斗规则编写 | `dotzuki-rules` | [战斗规则](../reference/battle-rules.md) |
| Tiled 地图导入 | `dotzuki-engine-tiled` | [地图指南](../how-to/maps.md) |
| 脚本编写 | `dotzuki-engine-script` | [i18n 指南](../how-to/i18n.md) |
| DSL 编译 | `dotzuki-engine-dsl` | [codegen 约定](../reference/dsl/codegen.md) |
| 渲染 | `dotzuki-renderer` / `dotzuki-ui` | [GUI 参考](../reference/dsl/gui.md) |
| 音频 | `dotzuki-audio` | [音频指南](../how-to/audio.md) |
| 零 Rust 运行时 | `dotzuki-runner` | [项目清单](../reference/project-manifest.md) |
| CLI | `dotzuki-cli` | [CLI 参考](../reference/cli.md) |
| 编辑器 | `tools/dotzuki-editor` | [编辑器 README](../../tools/dotzuki-editor/README.md) |

## 相关页面

- [GameData provider 设计](game-data.md)
- [存档兼容性](save-compatibility.md)
- [术语表](../reference/glossary.md)
