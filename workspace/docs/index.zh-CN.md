# dotzuki 引擎 — 文档索引

> 本文是 `index.md` 的中文翻译，同步至引擎版本 v0.1.0（源文档 commit 3133fb419ae3bc6e5c08bbbcd43ac7fa0289e44f）。
> 内容以英文源为准；发现不一致请更新英文源再同步翻译。

本目录是 **dotzuki 开发者文档的入口**。引擎不绑定任何具体游戏，游戏仓库以 Cargo git
依赖的形式使用它；大多数游戏作者完全不用碰 Rust。请在下面选择你的路径。

中文翻译版（`-zh-CN` 后缀的伴生文件）收录在 `SUMMARY.md` 的「中文（zh-CN）」分组中；
内容以英文源为准（doc-standard §6）。

## 读者指南

| 你是…… | 从这里开始 |
|---|---|
| 游戏作者，零 Rust，想**不写代码**做一个游戏 | [`tutorials/quickstart.md`](./tutorials/quickstart.md) —— 5 分钟 CLI 路径（`dotzuki new` → 编辑 `.scene` → `dotzuki run`）。随后看 [`reference/project-manifest.md`](./reference/project-manifest.md) 了解完整的项目清单与约定。 |
| 使用 **dotzuki-editor**（基于 Vue 的编辑器）的游戏作者 | [`tutorials/editor-first-game.md`](./tutorials/editor-first-game.md) 和 [`../tools/dotzuki-editor/README.md`](../tools/dotzuki-editor/README.md) |
| 编写**战斗规则**（效果栈、`rules.ron`） | 编写方法见 [`how-to/battles.md`](./how-to/battles.md)；规则格式见 [`reference/battle-rules.md`](./reference/battle-rules.md)；模型讲解见 [`explanation/effect-stack.md`](./explanation/effect-stack.md) |
| 编写 **DSL**（`.scene` / `.gui` / `.theme` / `.style`） | [`reference/dsl/scene.md`](./reference/dsl/scene.md)、[`reference/dsl/gui.md`](./reference/dsl/gui.md)、[`reference/dsl/theme-style.md`](./reference/dsl/theme-style.md)、[`reference/dsl/codegen.md`](./reference/dsl/codegen.md) |
| 制作**地图**（Tiled `.tmx` + tilesets + 实体） | [`how-to/maps.md`](./how-to/maps.md)；地图实体的伴生文件 `objects.json` 也在该文档中有说明 |
| 制作**音频**（`data/audio/*.json` 音轨） | 格式见 [`how-to/audio.md`](./how-to/audio.md)，22 个命令见 [`reference/audio-commands.md`](./reference/audio-commands.md) |
| 编写**双语文本** | [`how-to/i18n.md`](./how-to/i18n.md) —— `game.lang()` / `game.t()` / `@t` |
| 在终端中运行 / 自动化项目 | [`reference/cli.md`](./reference/cli.md) —— `dotzuki new` / `check` / `run` 及所有 flag |
| 发布 / 部署 / 升级 | [`how-to/publishing.md`](./how-to/publishing.md) —— 项目交付、无头模式 CI、WASM 网页试玩、引擎升级、存档兼容 |
| 扩展引擎的 **Rust 开发者** | 当前架构见 [`explanation/architecture.md`](./explanation/architecture.md)，crate map 与 docs.rs 链接见 [`reference/rustdoc.md`](./reference/rustdoc.md)，`GameData` trait 见 [`explanation/game-data.md`](./explanation/game-data.md) |
| 查询术语 | [`reference/glossary.md`](./reference/glossary.md) —— 权威术语表 |

## 教程

| 文档 | 涵盖内容 |
|---|---|
| [`tutorials/quickstart.md`](./tutorials/quickstart.md) | 5 分钟零代码之旅：`dotzuki new` → 编辑 `.scene` → `check` → `run` |
| [`tutorials/your-first-game.md`](./tutorials/your-first-game.md) | 逐步构建 `examples/your-first-game/` 项目：城镇、脚本战斗、随机遇敌、存档 |
| [`tutorials/editor-first-game.md`](./tutorials/editor-first-game.md) | 15 分钟带你逛一遍 dotzuki-editor，从一台空机器到一个带战斗的可玩项目 |

## 指南

| 文档 | 涵盖内容 |
|---|---|
| [`how-to/maps.md`](./how-to/maps.md) | Tiled `.tmx`（JSON）地图、tilesets、海拔、实体以及 `objects.json` 伴生文件 |
| [`how-to/battles.md`](./how-to/battles.md) | 编写 `rules.ron`：minimon 教程、属性克制、资源与招式消耗、cookbook、确定性 |
| [`how-to/themes.md`](./how-to/themes.md) | 声明 `.theme` / `.style` 文件并应用到 UI |
| [`how-to/audio.md`](./how-to/audio.md) | `TrackDef` JSON 音轨、通道、场景播放、编写要点 |
| [`how-to/i18n.md`](./how-to/i18n.md) | 双语文本：`game` i18n API 与 `@t` 语法 |
| [`how-to/publishing.md`](./how-to/publishing.md) | 发布项目、无头模式冒烟测试、WASM 网页试玩、引擎升级 |

## 参考

| 文档 | 涵盖内容 |
|---|---|
| [`reference/project-manifest.md`](./reference/project-manifest.md) | 零 Rust 项目的项目清单（`.dotzuki-editor.json`）、目录结构、`dotzuki run`/`check` 行为约定、编辑器试玩 |
| [`reference/battle-rules.md`](./reference/battle-rules.md) | 项目清单的 `battle` 段、`rules.ron` hooks、校验约定 |
| [`reference/data-tables/`](./reference/data-tables/combatants.md) | 记录 schema：[combatants](./reference/data-tables/combatants.md)、[encounters](./reference/data-tables/encounters.md)、[skills](./reference/data-tables/skills.md)、[items](./reference/data-tables/items.md)、[levels](./reference/data-tables/levels.md) |
| [`reference/dsl/scene.md`](./reference/dsl/scene.md) | `.scene` 语法 —— 已与 parser/interpreter 逐项核对，每个构造都标注了对应代码位置 |
| [`reference/dsl/gui.md`](./reference/dsl/gui.md) | 已实现的 `.gui` / `ui {}` 语法、组件 schema v2、`@t` |
| [`reference/dsl/theme-style.md`](./reference/dsl/theme-style.md) | `@theme` / `@style` 语法与 codegen 输出 |
| [`reference/dsl/codegen.md`](./reference/dsl/codegen.md) | DSL → JS/JSON 编译约定，已与代码对齐 |
| [`reference/audio-commands.md`](./reference/audio-commands.md) | 22 个 `AudioCommand` 变体及其字段 |
| [`reference/cli.md`](./reference/cli.md) | 每个 `dotzuki` 子命令与 flag、退出码 |
| [`reference/glossary.md`](./reference/glossary.md) | 权威术语定义 |
| [`reference/rustdoc.md`](./reference/rustdoc.md) | 面向 Rust 开发者的 crate map 与 docs.rs 链接 |

## 概念

| 文档 | 涵盖内容 |
|---|---|
| [`explanation/architecture.md`](./explanation/architecture.md) | 当前架构：引擎 crate、运行器、CLI、编辑器，以及从 DSL 到游戏的流程 |
| [`explanation/effect-stack.md`](./explanation/effect-stack.md) | 战斗效果栈模型、event/handler 架构、RNG 确定性、如实说明的限制 |
| [`explanation/game-data.md`](./explanation/game-data.md) | `GameData` 提供者 trait 及其泛型关联类型 |
| [`explanation/save-compatibility.md`](./explanation/save-compatibility.md) | 存档版本机制与向前/向后兼容规则 |

## 发布说明

- [`release-notes/changelog.md`](./release-notes/changelog.md) —— 版本历史；每个版本的迁移指南与它放在一起

## 归档

历史文档，保留作为背景参考。其中的链接不再维护；请改读上面的现行页面。

| 文档 | 是什么 |
|---|---|
| [`archive/developer-guide-legacy.md`](./archive/developer-guide-legacy.md) | 引擎拆分前、围绕旧版 `Provider` API 路径编写的指南；已被 `explanation/architecture.md` 取代 |
| [`archive/full-dsl.md`](./archive/full-dsl.md) | 完整愿景的 DSL 概览，标注已实现/拟议状态；已被 `reference/dsl/*` 取代 |
| [`archive/dsl-unified-design.md`](./archive/dsl-unified-design.md) | DSL 迁移分支留下的内部设计文档；已并入 `reference/dsl/codegen.md` |
| [`archive/game-ui-dsl.md`](./archive/game-ui-dsl.md) | 旧版 GUI DSL 文档，混杂已实现语法与提案；已实现的部分现收录于 `reference/dsl/gui.md` |

## 文档体系

- [`doc-standard.md`](./doc-standard.md) —— 本站遵循的写作与结构规范（四层模型、元信息头、新鲜度三态、
  语言政策、风格规则、示例验证、与代码同步的流程）。
- [`doc-outline.md`](./doc-outline.md) —— 目标站点大纲，以及形成当前布局的迁移对照表。
- 每页都带元信息头（`Audience` / `Type` / `Status` / `Last verified`）；Clausura AI 门禁
  （`.github/workflows/docs-review.yml`）会在每个 PR 中对照 `doc-standard.md` 评审文档变更。

## 仓库其他相关文档

- [`/README.md`](../../README.md) —— 仓库首页：引擎是什么、crate 列表、git 依赖用法、构建方式
- [`/AGENTS.md`](../../AGENTS.md) —— 面向在引擎上工作的 AI agent 的入门指引
- [`tools/dotzuki-editor/README.md`](../tools/dotzuki-editor/README.md) —— 编辑器完整指南；
  [`AI_AGENT_FRAMEWORK.md`](../tools/dotzuki-editor/docs/AI_AGENT_FRAMEWORK.md) —— 编辑器的 AI Story Designer 框架
- [`tools/asset-converter/README.md`](../tools/asset-converter/README.md) —— 2bpp → RGBA tileset + Tiled `.tsx` 转换器
- [`dotzuki-template/README.md`](../dotzuki-template/README.md) —— cargo-generate Rust 模板（旧版 `main.rs` 路径；
  零 Rust 路径是 `dotzuki new` + 项目清单）
