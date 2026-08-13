# dotzuki 文档写作与结构规范（Documentation Standard）

> 适用范围：本仓库所有面向用户的文档（`workspace/docs/`、根 `README.md`、
> 各工具目录的 `README.md` 与 `docs/`）。rustdoc 注释遵循本规范的写作风格部分。
> 目标大纲与站点结构见 [`doc-outline.md`](./doc-outline.md)。

本规范对标 [Godot 官方文档写作指南](https://docs.godotengine.org/en/stable/contributing/documentation/docs_writing_guidelines.html)
与 RPG Maker 官方手册的组织方式，并结合本项目实际定制。

## 1. 文档四层模型

每篇文档必须归属于以下四层之一，并在元信息头中声明（见 §4）。
一层一个用途，禁止混用：

| 层 | 英文名 | 回答的问题 | 判定标准 | 对标 |
|---|---|---|---|---|
| 教程 | Tutorial | "怎么入门？" | 面向新手、按步骤走完能获得完整成果、不允许跳过步骤 | Godot Getting started / RPG Maker 教程项目 |
| 指南 | How-to | "怎么做 X？" | 面向已有基础者、以任务为单位、可任意顺序阅读 | Godot Manual / RPG Maker 手册 Map/Database/Events 分章 |
| 参考 | Reference | "X 的准确定义是什么？" | 纯事实、可检索、无叙事、每条目含最小示例 | Godot Class Reference / RPG Maker Database 各表说明 |
| 概念 | Explanation | "为什么这样设计？" | 讲背景与权衡、不教操作、允许任意顺序 | Godot Manual 中的概念章节 |

判定口诀：**教入门是教程，教任务是指南，查定义是参考，讲道理是概念。**

## 2. 读者分层

文档必须面向下列四类读者之一（可多个，需声明），并只写该读者关心的内容：

1. **游戏作者（zero-Rust）**——用编辑器 / DSL / `dotzuki` CLI 做游戏，不写 Rust
2. **Rust 游戏开发者**——以 Cargo git dependency 方式消费引擎 crate
3. **工具/编辑器扩展开发者**——为 dotzuki-editor 写扩展或接入资产管线
4. **引擎贡献者**——修改 `workspace/crates/` 内引擎代码

对第 1 类读者的文档，禁止出现 Rust 代码（除 `Cargo.toml` 片段外）。

## 3. 组织原则

1. **按创作任务组织，不按 crate 组织**。对标 RPG Maker 手册按编辑器界面分章
   （Map / Database / Events）——dotzuki 对应编辑器 Activities
   （Maps / Scripts / Data / Assets / Tiles / Story / Play）。crate 边界只出现在
   概念层与 rustdoc 中。
2. **一个主题一页**。页面超过约 800–1000 行时拆页，并在拆出的页面间互链。
3. **目录即层级**。文件名所在目录必须与其所属层一致（`how-to/`、`reference/` 等）。
4. **历史内容必须隔离**。过时文档移入 `archive/`，禁止留在活跃目录中"带病运行"。

## 4. 每篇文档的强制结构

### 4.1 元信息头（必填）

每篇文档在标题后紧跟一个元信息块：

```markdown
> - **Audience**（读者）: game authors / rust developers / tool developers / engine contributors
> - **Type**（层级）: tutorial / how-to / reference / explanation
> - **Status**（状态）: active / deprecated / archived
> - **Last verified**（最近核对）: v0.5.0
```

- `Audience`、`Type`、`Status` 必填；`Last verified` 记录该文档最近一次与代码核对的引擎版本，正文更新时同步刷新。
- 标题之后必须有一句话摘要（该页回答什么问题的 1–2 句说明）。
- 教程与指南必须列出前置阅读（"开始前，请先完成 / 阅读 …"）。

### 4.2 交叉引用

- 链接一律使用相对路径；引用其他文档时写其路径而非口头描述。
- 首次提及术语时链接到 `explanation/glossary.md` 的对应条目（术语表未收录时先补录）。

## 5. 新鲜度三态

| 状态 | 含义 | 处置 |
|---|---|---|
| `active` | 与当前代码一致 | 正常维护 |
| `deprecated` | 部分过时或将被取代 | 页面顶部加横幅（见下），说明替代品；正文不更新 |
| `archived` | 已过时，仅供考古 | 移入 `archive/`，不再出现在站点导航中 |

`deprecated` 文档顶部横幅格式：

```markdown
> **Deprecated** — 本文档描述旧架构（legacy `Provider` API）。现行接口见
> [`explanation/architecture.md`](...)，历史背景见 `archive/developer-guide-legacy.md`。
```

规则：

- 一次 PR 只允许把一个文档从 `active` 改为 `deprecated`（并附替代链接），
  或从 `deprecated` 移入 `archive/`——两件事分开做，保证每条变化可审查。
- `archive/` 内文档不保证链接有效、不更新内容。

## 6. 语言政策

1. **源语言为英文**。面向用户（游戏作者、Rust 开发者）的文档一律以英文撰写；
   中文翻译版以 `-zh-CN` 后缀并列存在（如 `BATTLE_ENGINE_GUIDE.md` →
   `BATTLE_ENGINE_GUIDE.zh-CN.md`）。
2. **翻译版是派生品**。每篇翻译版在头部标注：

   ```markdown
   > 本文是 `xxx.md` 的中文翻译，同步至引擎版本 v0.5.0（源文档 commit <sha>）。
   > 内容以英文源为准；发现不一致请更新英文源再同步翻译。
   ```

3. **禁止单侧修改翻译版**。翻译版只能改措辞，不能增删技术内容。
4. 现存的纯中文文档（如 `THEME_STYLE_DSL.md`）在迁移时补英文源，中文版降为翻译版。
5. 本仓库的内部元文档（本规范、`AGENTS.md`）不受第 1 条约束，可用中文。

## 7. 命名与文件组织

1. **文件名用 kebab-case 小写**（`your-first-game.md`、`audio-commands.md`）。
   现有 `UPPER_SNAKE` 命名（`CLI_REFERENCE.md` 等）是旧惯例，迁移时重命名。
2. 翻译版后缀固定为 `-zh-CN`（插在扩展名之前）。
3. 目录名即层名：`tutorials/`、`how-to/`、`reference/`、`explanation/`、
   `release-notes/`、`archive/`。
4. 站点入口页为 `docs/index.md`（由现 `docs/README.md` 迁移而来）。

## 8. 写作风格

### 8.1 英文（源语言）

直接采用 Godot 写作指南的规则，作为我们的默认：

1. 主动语态优先（"The dog bit the man"，不是 "The man was bitten"）
2. 用精确的动作动词，避免泛化动词（`make`、`set`）
3. 避免 -ing 进行式（描述瞬时动作用一般现在时）
4. 删掉不必要的副词、形容词
5. **禁词表**（Godot 同款 8 词）：`obvious, simple, basic, easy, actual, just, clear, however`
   及其副词形式。理由：对读者而言没有什么是 obviously simple 的
6. 显式指代：重复名词，不用 "the former / the latter"
7. 所有格用 `'s`，不用 "of the X"
8. 列举用 Oxford comma
9. 每行手动换行，不超过 100 字符（链接与表格除外）
10. 示例代码用真实场景命名，禁止 `foo` / `bar` / `my_var`；最好是从可运行示例中复制

### 8.2 中文

1. 主动语态优先："引擎加载存档" 而非 "存档被引擎加载"
2. 禁词表：`显然、简单、基础、容易、实际（上）、只是、很清楚、然而` —— 与英文禁词表对应
3. 术语与代码标识符保持英文原文（`effect stack`、`GameData`），首次出现给出中文解释
4. 中英混排时英文词两侧加空格（"一个 `StackDriver` 实例"）

### 8.3 界面与代码的标记约定

| 对象 | 标记 |
|---|---|
| 编辑器 UI（菜单、按钮、面板名） | **加粗**，大小写与编辑器完全一致，路径用 `>` 分隔（**Maps > Entities**） |
| 字面值、字段名、CLI 参数 | `` `code` `` |
| 文件路径 | `` `code` ``，用仓库相对路径 |
| 首次提及的类型 / 条目 | 链接（仅每页首次；再次出现用 `` `code` ``） |

## 9. 示例代码规则

1. **可验证优先**。每个代码块必须能通过验证，验证方式按内容类型：
   - Rust 示例 → 作为 crate 的 example / rustdoc 测试（`cargo test --doc`），进 CI
   - DSL 示例（`.scene` / `.gui` / `.theme` / `.style`）→ `scene_check` 可编译通过
   - RON 规则示例 → minimon 或 rules 测试可加载
   - CLI 示例 → 从 `CLI_REFERENCE.md` 的真实输出复制
2. 无法验证的示例必须显式标注 `<!-- not verified -->`，且为临时状态。
3. 示例必须完整（含所需的文件头、import），禁止 `...` 省略关键部分。
4. 教程中的每个示例都必须指向一个能跑通的最终状态（读者可逐步复现）。

## 10. 版本引用规则

沿用 Godot 的规则，避免正文堆砌版本史：

1. 正文**不写**"自 v0.x 起引入"——当前文档只描述当前行为。
2. 版本变化信息只出现在两个地方：`release-notes/changelog.md` 与迁移指南。
3. 例外：当前大版本内新引入的**默认行为变化**（旧行为与新行为并存过渡时），
   可在正文用一句话对照说明。

## 11. 与代码同步的流程

1. **文档与代码同 PR**。改变对外行为的代码提交必须同时更新受影响文档；
   纯文档修复（错字、措辞）可单独提交。
2. **以代码为准**。文档与实现冲突时，代码是 truth；文档进入 `deprecated` 流程或立即修正。
3. 文档 PR 的检查清单（提交前逐项确认）：
   - [ ] 元信息头完整（Audience / Type / Status / Last verified）
   - [ ] 交叉引用路径存在（`mdbook build` 或链接检查通过）
   - [ ] 示例已按 §9 验证
   - [ ] 若新增/改名页面，索引页与 `SUMMARY.md` 已同步
   - [ ] 术语首现已链接 glossary（未收录则补录）
4. 术语表（`explanation/glossary.md`）是术语的唯一权威；新增公共术语必须先在 glossary 定义。
5. **CI 门禁（Clausura）**：`.github/workflows/docs-review.yml` 在每个触及
   `workspace/docs/**`、根 `README.md` 或 Clausura 配置的 PR/推送中运行
   [Clausura](https://github.com/liuyanghejerry/Clausura) 评审——审查 skill
   （`.clausura/skills/docs-review/SKILL.md`）把本规范注入为唯一核对清单，
   `error` 级发现项按 `.clausura.yaml` 的 gating 规则阻断合并；`warning`
   只告警不阻断。紧急豁免：给 PR 打 `docs-ai-skip` 标签。门禁需仓库 secret
   `CLAUSURA_API_KEY` 才启用，未配置时静默跳过并告警。

## 12. 索引页规则

`docs/index.md` 的 Reader guide 必须按读者身份给出入口路径，格式保持现状：

- 每行：读者身份 → 起点文档 → 随后阅读什么
- 索引页只做导航，不承载正文；新增文档必须同步更新索引。

---

*本规范自身遵循 §4 元信息头之外的约定（内部元文档，中文）。规范变更与文档体系迁移走同一分支评审。*
