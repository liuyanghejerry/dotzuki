# dotzuki 文档体系：呈现形式与内容大纲

> 本文档定义文档体系的**呈现形式**（怎么发布、怎么导航、读者走哪条路）和
> **目标内容大纲**（每页是什么、从哪来）。写作规则见
> [`doc-standard.md`](./doc-standard.md)。状态：proposal，待评审后执行迁移。

## 1. 对标结论

| 对标对象 | 借鉴什么 | 落到 dotzuki |
|---|---|---|
| [Godot](https://docs.godotengine.org/en/stable/) | 四层结构（Getting started / Manual / Class Reference）；版本化站点；文档与代码同仓库；写作规范 | 四层模型（见 doc-standard §1）；站点按 tag 发布版本；`workspace/docs/` 即站点源 |
| RPG Maker（[官方手册](https://papocle.fr/Manuels/RPG_Maker_MZ_Help_Documentation_2020.pdf)） | 手册按创作界面分章（Map / Database / Events）；随产品附教程项目；编辑器内置 F1 帮助 | 指南/参考层按编辑器 Activities 组织（Maps / Data / Scripts …）；`your-first-game` 教程项目；编辑器内帮助面板（远期） |
| [Bevy](https://bevyengine.org/learn/)（Rust 生态） | Book + Examples + API Docs + Migration Guides 四件套 | mdBook 站点 + crate examples + docs.rs 门户 + `release-notes/` |

## 2. 呈现形式（Presentation）

### 2.1 站点：mdBook + GitHub Pages

- **载体决定**：mdBook。理由：Rust 生态标准（Bevy Book 同款）、`SUMMARY.md`
  即大纲（与本文档 §3 一一对应）、内置搜索、可在 CI 中 `mdbook test` 校验示例。
- **源与呈现分离**：`workspace/docs/` 目录是唯一 source of truth，
  mdBook 只是呈现层。本地 GitHub 上阅读裸 Markdown 与站点读感一致。
- **版本化**：GitHub Pages 按 tag 发布（`/stable/`、`/v0.5.0/`），对标 Godot
  docs 的版本目录。发布由 CI 完成（见 M1 里程碑）。
- **搜索与导航**：mdBook 内置搜索；侧边栏 = `SUMMARY.md`。

### 2.2 教程项目（对标 RPG Maker 的 tutorial）

- 教程层以**一个可玩的示例游戏**为骨架：一个城镇 + 一场战斗 + 一段剧情 +
  一份存档。它同时是：
  1. `tutorials/your-first-game.md` 的"逐步搭建"载体（对标 Godot
     "Your first 2D game"）
  2. `dotzuki new` 的可选模板（对标 GB Studio 的 Sample Project）
- 落地位置：`examples/` 下新目录（引擎仓库内，随 CI 跑通）。只有教程项目复杂到
  需要独立演进（独立发布、独立版本、多人维护）时，才拆分为独立仓库。

### 2.3 编辑器内帮助（对标 RPG Maker 的 F1 / Help → Contents）

- 远期目标：dotzuki-editor 内置帮助面板，渲染 reference 层页面
  （数据表 schema、DSL 语法、CLI 速查），让 zero-Rust 作者不离开编辑器查文档。
- 在此之前，编辑器 README 深链到站点的 reference 页面即可。

### 2.4 读者路径（Reader paths）

```
游戏作者（zero-Rust）：
  tutorials/quickstart → tutorials/your-first-game → how-to/*（按需）→ reference/*（查询）
Rust 游戏开发者：
  index → explanation/architecture → reference/rustdoc → release-notes/migration
工具开发者：
  index → reference/project-manifest → reference/dsl/* → tools/*/README
引擎贡献者：
  index → explanation/* → crate rustdoc → doc-standard（本文档体系）
```

## 3. 内容大纲（即未来 `SUMMARY.md`）

图例：**[迁移]** 现有内容搬入 · **[拆分]** 现有文档拆多页 ·
**[新建]** 尚不存在 · **[调和]** 多份矛盾文档合并。

```
docs/                              # mdBook src
├── index.md                       # [迁移] ← docs/README.md（Reader guide + 文档状态索引）
├── tutorials/                     # —— 教程层：教入门 ——
│   ├── quickstart.md              # [迁移] ← QUICKSTART.md（校对后原样迁入）
│   ├── your-first-game.md         # [新建] 端到端教程：城镇→剧情→战斗→存档
│   └── editor-first-game.md       # [迁移] ← tools/dotzuki-editor/docs/first-game.md
├── how-to/                        # —— 指南层：教任务 ——
│   ├── maps.md                    # [新建] Tiled 地图 + objects.json 工作流（自 spec §Maps 抽出）
│   ├── scenes.md                  # [新建] .scene 剧情/事件脚本工作流
│   ├── battles.md                 # [拆分] ← BATTLE_ENGINE_GUIDE.md 的 RON 作者向部分
│   ├── ui.md                      # [新建] .gui 布局制作（编辑器 Scripts 活动）
│   ├── themes.md                  # [拆分] ← THEME_STYLE_DSL.md 的使用部分
│   ├── audio.md                   # [迁移] ← AUDIO.md
│   ├── assets.md                  # [新建] 素材管线：asset-converter、tileset、CJK 字体
│   ├── i18n.md                    # [迁移] ← JS_SCRIPT_I18N.md 的现行部分
│   └── publishing.md              # [迁移] ← PUBLISHING.md
├── reference/                     # —— 参考层：查定义 ——
│   ├── project-manifest.md        # [拆分] ← game-project-spec.md §Manifest + §run 契约
│   ├── data-tables/               # [拆分] ← game-project-spec.md 数据表 schema
│   │   ├── combatants.md
│   │   ├── encounters.md
│   │   ├── skills.md
│   │   ├── items.md
│   │   └── levels.md
│   ├── battle-rules.md            # [新建] rules.ron 语法参考（自 battles.md 抽语法面）
│   ├── dsl/                       # —— DSL 权威参考（以编译器实现为准）——
│   │   ├── scene.md               # [新建] .scene 语法（以 interpreter.rs 为准）
│   │   ├── gui.md                 # [拆分] ← GAME_UI_DSL.md 的已实现部分
│   │   ├── theme-style.md         # [拆分] ← THEME_STYLE_DSL.md 的语法部分
│   │   └── codegen.md             # [调和] ← DSL_MAPPING.md × DSL_UNIFIED_DESIGN.md（按代码裁定）
│   ├── audio-commands.md          # [新建] 21 个 AudioCommand 速查表（自 AUDIO.md 抽出）
│   ├── cli.md                     # [迁移] ← CLI_REFERENCE.md
│   ├── glossary.md                # [新建] 术语表（doc-standard §11 的唯一术语权威）
│   └── rustdoc.md                 # [新建] crate 地图 + docs.rs 门户（供 Rust 开发者）
├── explanation/                   # —— 概念层：讲道理 ——
│   ├── architecture.md            # [新建] 当前架构总览（替代历史 DEVELOPER_GUIDE.md 的定位）
│   ├── effect-stack.md            # [拆分] ← BATTLE_ENGINE_GUIDE.md 的概念/设计部分
│   ├── game-data.md               # [新建] GameData GAT 设计：为什么用泛型关联类型
│   └── save-compatibility.md      # [拆分] ← game-project-spec.md §Compatibility rules
├── release-notes/                 # —— 版本信息 ——
│   ├── changelog.md               # [新建] 自当前版本起维护
│   └── migration/                 # [新建] 每版本一篇：vX.Y → vX.Z 升级指南
└── archive/                       # —— 历史文档隔离区 ——
    ├── developer-guide-legacy.md  # [迁移] ← DEVELOPER_GUIDE.md
    ├── full-dsl.md                # [迁移] ← FULL_DSL.md
    ├── dsl-unified-design.md      # [迁移] ← DSL_UNIFIED_DESIGN.md（调和后归档）
    └── game-ui-dsl.md             # [迁移] ← GAME_UI_DSL.md（已实现部分已抽入 reference/dsl/gui.md）
```

### 3.1 迁移映射表（现有文件 → 新位置）

| 现有文件 | 去向 |
|---|---|
| `docs/README.md` | `index.md`（Reader guide 保留，文档状态索引更新） |
| `docs/QUICKSTART.md` | `tutorials/quickstart.md` |
| `docs/BATTLE_ENGINE_GUIDE.md` | 拆分为 `how-to/battles.md` + `explanation/effect-stack.md` |
| `docs/BATTLE_ENGINE_GUIDE.zh-CN.md` | 已删除：英文源拆分后翻译失效（doc-standard §6 翻译须跟踪源）；需要时按新结构重译 |
| `docs/GAME_UI_DSL.md` | 已实现部分 → `reference/dsl/gui.md`；原文整体归档为 `archive/game-ui-dsl.md` |
| `docs/THEME_STYLE_DSL.md` | 补英文源，拆为 `how-to/themes.md` + `reference/dsl/theme-style.md` |
| `docs/DSL_MAPPING.md` | 与 DSL_UNIFIED_DESIGN 按代码调和 → `reference/dsl/codegen.md` |
| `docs/DSL_UNIFIED_DESIGN.md` | 同上，调和后 → `archive/dsl-unified-design.md` |
| `docs/FULL_DSL.md` | `archive/full-dsl.md` |
| `docs/DEVELOPER_GUIDE.md` | `archive/developer-guide-legacy.md`；现行内容由 `explanation/architecture.md` 承接 |
| `docs/JS_SCRIPT_I18N.md` | 整体 → `how-to/i18n.md`（全文现行，无需归档拆分） |
| `docs/AUDIO.md` | `how-to/audio.md` + 抽出 `reference/audio-commands.md` |
| `docs/CLI_REFERENCE.md` | `reference/cli.md` |
| `docs/PUBLISHING.md` | `how-to/publishing.md` |
| `docs/game-project-spec.md` | 拆为 `reference/project-manifest.md` + `reference/data-tables/*` + `explanation/save-compatibility.md` + 素材内容入 `how-to/` |
| `tools/dotzuki-editor/docs/first-game.md` | `tutorials/editor-first-game.md` |
| `tools/dotzuki-editor/README.md` | 保留原位；站点 how-to 层深链到它 |
| `dotzuki-template/README.md`、`tools/asset-converter/README.md` | 保留原位；`how-to/assets.md` 深链 |
| 根 `README.md` | 保留（落地页），指向站点 |

### 3.2 站点范围边界

- 站点收录两类读者内容：**游戏作者** 与 **Rust 游戏开发者/引擎贡献者**。
- 编辑器扩展开发文档（`AI_AGENT_FRAMEWORK.md` 等）暂留在
  `tools/dotzuki-editor/docs/`，待编辑器文档量增长后再并入站点。
- 内部过程文档（`NEW-PROJECT-UX-ANALYSIS.md` 等）永不进站点。

## 4. 迁移里程碑

| 里程碑 | 内容 | 完成判据 |
|---|---|---|
| **M0（本分支）** | 订立规范 + 大纲（本文档 + `doc-standard.md`） | 评审通过，合入 master |
| **M1 站点骨架** | `book.toml` + `SUMMARY.md`（按 §3 生成）+ CI 发布到 GitHub Pages（按 tag 版本化） | 站点可访问、有搜索、无内容变动 |
| **M2 内容迁移** | 按 §3.1 映射表迁移/拆分现有文档；archive 隔离历史文档；调和 DSL 矛盾（以代码为准） | 所有现有文档就位；索引更新；链接全通 |
| **M3 新内容补齐** | `your-first-game` 教程项目与页面、`glossary.md`、`architecture.md`、`changelog.md` + 首篇迁移指南 | 教程可逐步复现；术语表覆盖正文术语 |
| **M4 体验增强** | 编辑器内帮助面板（渲染 reference 页）；`dotzuki new` 教程模板 | zero-Rust 作者全程不离开编辑器 |

每阶段独立 PR，逐段评审；M1–M4 期间原文档保持可读（迁移完成前不做破坏性移动）。
