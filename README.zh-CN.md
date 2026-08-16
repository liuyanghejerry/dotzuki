<div align="center">

<img src="workspace/resources/icon.png" width="128" alt="dotzuki">

# dotzuki

**做一个经典 JRPG —— 一行 Rust 都不用写。**

[![crates.io](https://img.shields.io/crates/v/dotzuki-engine.svg)](https://crates.io/crates/dotzuki-engine)
[![Rust](https://img.shields.io/badge/Rust-1.70%2B-orange)](https://www.rust-lang.org/)
[![License: MIT OR Apache-2.0](https://img.shields.io/badge/License-MIT%20OR%20Apache--2.0-blue.svg)](#license许可证)
[![Docs](https://img.shields.io/badge/docs-liuyanghejerry.github.io%2Fdotzuki-blue)](https://liuyanghejerry.github.io/dotzuki/stable/)

[快速上手](#5-分钟做出一个游戏) ·
[文档](https://liuyanghejerry.github.io/dotzuki/stable/) ·
[编辑器](workspace/tools/dotzuki-editor/) ·
[示例](workspace/examples/)

[English](README.md) · **中文**

</div>

> 本文是 [README.md](README.md) 的中文翻译，
> 同步至引擎版本 v0.1.1（源文档 commit afab36d92a4aab566f3a1057639f3c8fcf8b2f09）。
> 内容以英文源为准；发现不一致请更新英文源再同步翻译。

dotzuki 是一个用来制作经典 Game Boy 风格 JRPG 的游戏引擎 ——
大地图、NPC 对话、回合制战斗、商店、菜单、芯片音乐风格的音频、双语文本 ——
全部通过声明式 DSL 和可视化编辑器完成。你写的是剧本和规则，不是引擎代码。

引擎用 Rust 从零编写，是对经典 JRPG 机制的原创独立实现 ——
不源自任何现有游戏的代码，也不是 Game Boy 模拟器。

## 5 分钟做出一个游戏

不需要 Rust。 scaffold 一个项目，写一个场景，直接开玩：

```bash
dotzuki new my-game
cd my-game
dotzuki run .
```

一个场景就是一个文本文件：

```dsl
game_scene Main {
    @storylines {
        @speaker("Guide") {
            "Welcome to your new JRPG project!"
            "Choose your starter!"
        }
        @choice {
            @option("Ember") {
                @speaker("Guide") {
                    @t("Ember is the fire type!", "炎系的选择！")
                }
            }
            @option("Dew") {
                @speaker("Guide") {
                    @t("Dew is the water type!", "水系的选择！")
                }
            }
        }
    }
}
```

`@t("en", "中文")` 让每句话天生双语 —— `dotzuki run --lang zh`
一键切换语言。`dotzuki run . --watch` 会在你保存文件时热重载场景和地图。

## 为什么是 dotzuki

- **零 Rust 创作游戏** —— 一个游戏项目 = 一份 manifest + DSL 文件 + 地图 + 素材。
  `dotzuki new` / `check` / `run` 就是全部工具链。
- **战斗即数据** —— 回合制战斗跑在 effect-stack 引擎上；
  招式、属性克制、状态规则都在 `rules.ron` 里声明式编写。
- **可视化编辑器** —— dotzuki-editor（Vue/Vite）自带创建向导、
  地图/DSL 编辑、AI 剧情设计师，以及由 WASM 版 runner 驱动的编辑器内试玩。
- **经典 GB 风格表现** —— 内置 tile/精灵渲染、CJK 像素字体、
  JRPG UI 组件和芯片音乐风格的音频层。
- **天生双语** —— `@t("en", "中文")` 从第一天起就支持场景、UI 布局和主题。
- **随处可玩** —— 原生应用壳、终端壳，以及可把游戏发布到浏览器里的 WASM 构建。

## 在 Rust 项目中使用引擎

所有 `dotzuki-*` crate 都已发布到 crates.io：

```toml
[dependencies]
dotzuki-engine = "0.1"
dotzuki-engine-dsl = "0.1"
```

也可以固定 git tag —— 所有 crate 都能从这同一个仓库解析：

```toml
[dependencies]
dotzuki-engine = { git = "https://github.com/liuyanghejerry/dotzuki", tag = "v0.1.1" }
```

引擎由 trait 驱动、与具体游戏无关：游戏数据通过 `GameData` trait 注入，
引擎里不含任何游戏内容。参见 [`workspace/examples/`](workspace/examples/) —
— 其中的 `minimon` 是一个完全基于 effect stack 构建的战斗演示，
`your-first-game` 是一个完整的示例项目。

<details>
<summary><b>Crate 一览</b>（点击展开）</summary>

- `dotzuki-engine` —— 核心 trait（`GameData`）、tilemap/相机/触发器、
  战斗 effect-stack（`battle::stack`）、道具/商店/装备系统、联机传输接口
- `dotzuki-rules` + `dotzuki-rules-macro` —— 声明式战斗规则：
  `rules.ron` → 运行时 Effect 栈
- `dotzuki-engine-dsl` —— Game DSL 编译器（`.scene` / `.gui` / `.theme` / `.style`，双语 `@t`），附带原生 AST 解释器
- `dotzuki-engine-tiled` —— Tiled `.tmx`（JSON）地图 → 引擎类型
- `dotzuki-engine-script` —— 基于 Boa 的异步 JS 脚本引擎
- `dotzuki-renderer` —— GB 风格 tile/精灵/文本渲染、CJK 像素字体、UI 布局
- `dotzuki-ui` —— 基于 `Painter` trait 的可复用 JRPG UI 组件
- `dotzuki-audio` —— 音频抽象层
- `dotzuki-app` / `dotzuki-tui` —— 原生应用壳（热重载）/ 终端壳
- `dotzuki-runner` + `dotzuki-runner-web` —— 零 Rust 项目运行时及其 WASM 构建
- `dotzuki-cli` —— `dotzuki` 二进制：`new` / `check` / `run`
- `dotzuki-web` —— 编辑器布局预览的 WASM 桥接

</details>

## 从源码构建

Cargo workspace 根目录在 `workspace/`：

```bash
cd workspace
cargo build --release
cargo test
target/release/dotzuki new demo && target/release/dotzuki run demo
```

发布时通过 `.github/workflows/release.yml` 用一个 `vX.Y.Z` tag
把所有 crate 发布到 crates.io —— 详见 `AGENTS.md` 的 "Releasing" 一节。

## License（许可证）

以下许可证任选其一：

- Apache License, Version 2.0（[LICENSE-APACHE](LICENSE-APACHE) 或 <http://www.apache.org/licenses/LICENSE-2.0>）
- MIT license（[LICENSE-MIT](LICENSE-MIT) 或 <http://opensource.org/licenses/MIT>）

### 贡献

除非你明确另行声明，否则任何有意提交以纳入本项目的贡献
（按 Apache-2.0 许可证的定义）均按上述双许可证授权，
不附加任何额外条款或条件。

