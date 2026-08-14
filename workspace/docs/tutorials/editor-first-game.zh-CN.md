# 15 分钟做出你的第一款游戏

> 本文是 `tutorials/editor-first-game.md` 的中文翻译，同步至引擎版本 v0.1.0（源文档 commit 3133fb419ae3bc6e5c08bbbcd43ac7fa0289e44f）。
> 内容以英文源为准；发现不一致请更新英文源再同步翻译。

> - **Audience**: game authors
> - **Type**: tutorial
> - **Status**: active
> - **Last verified**: v0.1.0

一次带你从头到尾走一遍的导览：从一台空机器，到一个可以点击游玩的 JRPG 项目 ——
不需要 Rust，不需要写代码。

你甚至可以直接**玩**你做出来的东西：`dotzuki run` 会在窗口中启动你的项目（大地图、
对话、传送点）。

## 1. 启动编辑器

```bash
cd tools/dotzuki-editor
pnpm install
pnpm dev          # http://localhost:5174
```

像这样从编辑器自己的仓库启动时，新项目默认创建在 **`~/dotzuki-projects/<your-game>`**
下 —— 不会往编辑器仓库写入任何东西。想把项目放到别处，就用
`DOTZUKI_PROJECT_ROOT=/path/to/projects pnpm dev` 启动服务器。

## 2. 创建项目

在欢迎屏幕上，二选一：

- 在 hero 输入框里**输入一句话构想**（"a cozy farming RPG on a floating island"），点
  Start —— AI 助手会提出一个脚手架方案，**Apply** 会把它建出来。这需要一个 AI
  provider 配置（Settings → providers；密钥只保存在你的浏览器里）。
- **或者打开向导**（*Create with the wizard* 卡片）：给游戏命名，选一个模板 ——
  **Generic JRPG** 是首选 —— 再确认目录名。Step 1 会在写入任何内容之前显示完整的
  目标路径。

成功面板会列出生成的内容并给出第一步建议。点击 **Open Editor**。

## 3. 浏览初始内容

新项目不是一个空壳。你会得到：

| 页签 | 里面有什么 |
|-----|------------------------|
| **Maps** | **StartTown** —— 一个小型示例城镇（池塘、房子、广场、花园），自带初始 tileset。绘制 tiles、编辑碰撞、放置实体。 |
| **Scripts** | `StartTown/script.scene` —— 这张地图的欢迎对话，用游戏 DSL 编写。改一行、保存、搞定。 |
| **Data** | 示例记录：一个英雄（*Aria*）、一个怪物（*Slime*）、一个 *Potion*（dotzuki 模板）。可以自己加行；表单根据数据表的 schema 生成。 |
| **Story** | 一份预置的叙事圣经：*Elder Mira*（角色）和 *Welcome to StartTown* 任务，与地图的场景相连。这就是 Story Designer —— 叙事圣经、任务图、一致性检查。 |
| **Tiles** | 共享的 tile 库，预置了 16 个初始 tile。 |

## 4. 把它变成你的 —— 三处五分钟小改动

1. **改掉欢迎台词。** Scripts 页签 → `StartTown/script.scene` → 编辑 `@speaker("Guide")`
   里的对话。场景用 `dotzuki check` 所校验的同款 DSL 编译。
2. **改造城镇。** Maps 页签 → StartTown → 从库里挑选 tiles 进行绘制。把池塘挖大、
   加盖第二栋房子、挪动花园。
3. **添加角色。** Story 页签 → 新角色，或 Data 页签 → 在 `heroes` 里新建记录。AI
   助手（✨）可以凭一句话简介丰富出性格、任务，乃至整段场景。
4. **开一场战斗**（dotzuki 模板）。在欢迎对话之后，往 `StartTown/script.scene` 加
   一行：

   ```
   @command("startBattle", "slime")
   ```

   `dotzuki run` 会暂停场景、切入战斗 —— Aria（你的第一条 `heroes` 记录）对战
   Slime —— 然后带着结果回到场景。战斗完全由数据驱动：数值来自记录字段，技能来自
   `spells` 表，属性克制来自 `data/rules.ron`。预置的 Slime 还掌握了 `venom-sting`，
   它在 `rules.ron` 里的 `Effect` 记录命中时施加中毒（30%）—— 而 `poison` 状态记录
   的 `Residual` hook 会在每次行动时削掉 1/8 最大 HP，全程不写一行 Rust。加一行怪物
   记录，教它 `tackle`，它立刻就能打。用 `result = startBattle("slime")` + `@if`
   接收战斗结果。

   或者挑战预置的 **trainer**：`@command("startBattle", "bug-catcher")` 读取
   `encounters` 表 —— 一支有序的敌方队伍（一个接一个出场，EXP 累加），带 trainer
   标记（Run 被禁用）和金钱奖励（胜利得 32 G）。野怪战斗的 **Run** 根菜单项始终
   可用，并把 `"run"` 返回给场景 —— 与 `"win"`、`"lose"` 都不同。

## 5. 玩起来

`dotzuki` CLI 会在窗口中启动你的项目 —— 用方向键在 StartTown 里走动，按 **Z**（A 键）
对话，在地图之间传送：

```bash
dotzuki run ~/dotzuki-projects/<your-game>
```

用于 CI 或快速冒烟测试时，`--headless`（无头模式）无需窗口即可运行帧，还能导出截图：

```bash
dotzuki run ~/dotzuki-projects/<your-game> --headless --frames 240 --screenshot shot.png
```

改动之后还可以对所有 DSL 文件做编译检查 —— 一旦某个 `.scene`/`.gui` 文件损坏，它会以
非零退出码结束并打印诊断信息：

```bash
dotzuki check ~/dotzuki-projects/<your-game>
```

（在编辑器里，Scripts 页签的 🔍 lint 会在你输入时揪出悬空 flag 和未知的 `game.*` API。）

## 接下来去哪

- **AI 辅助搭建** —— 助手可以起草地图（`propose_map_create`）、编辑项目清单、完善
  角色，还能为任务生成 `.scene` 实现。见
  [AI agent 框架](../../tools/dotzuki-editor/docs/AI_AGENT_FRAMEWORK.md)。
- **项目约定** —— [项目清单](../reference/project-manifest.md)定义了一个游戏项目包含
  什么，包括完整的 `dotzuki run` 行为（入口解析、场景分发、支持的命令）。
- **当前限制** —— 每种 `rules.ron` effect 类型都**是**数据驱动的（`kind: Move`/`Status`
  hooks —— 预置的 `venom-sting` + `poison` 展示了它的形态 —— 还有
  `kind: Ability`/`Item`/`Weather`：Aria 预置的 `intimidate` 会在换入时降低对手的
  攻击，Bryn 的 `leftovers` 在他的行动结束后给他回血，场景还可以在 `startBattle`
  之前用 `setWeather("sandstorm")` 布置预置的 `sandstorm`）；持有的道具不会被消耗，
  天气只属于单场战斗（只能由场景布置），战斗失败会治疗全队并把你送回入口地图的
  出生点（还没有治疗点系统）。其余内容都已就位：敌方队伍（`encounters` 表 —— 排队
  出场、EXP 累加）、trainer 战（Run 被禁用、胜利得钱）、仅野怪可用的 Run 动作（场景
  会看到第三种结果 `"run"`），以及半价出售的商店。规则格式见
  [战斗规则参考](../reference/battle-rules.md)。
