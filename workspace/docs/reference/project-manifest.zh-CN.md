# 游戏项目规范 — 零 Rust dotzuki-engine 项目

> 本文是 `reference/project-manifest.md` 的中文翻译，同步至引擎版本 v0.1.0（源文档 commit 3133fb419ae3bc6e5c08bbbcd43ac7fa0289e44f）。
> 内容以英文源为准；发现不一致请更新英文源再同步翻译。

零 Rust 项目契约：目录布局、项目清单 schema，以及 run/check/playtest 行为。

> - **Audience**: game authors, tool developers
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.1.0

一个**游戏项目**就是一个普通目录，里面放着 DSL、数据和资产文件，外加唯一一份
项目清单 `.dotzuki-editor.json`。游戏项目里没有 Cargo workspace、没有
`package.json`、也没有构建系统：引擎二进制和编辑器按原样消费这个目录。

本规范是创建、编辑、运行这类项目的工具之间的契约。该布局的参考实现是编辑器的
脚手架（`tools/dotzuki-editor/server/scaffold.ts`）；`dotzuki` CLI
（`crates/dotzuki-cli`）生成同样的布局。

## 消费方

| 消费方 | 它对游戏项目做什么 |
|----------|----------------------------------|
| **dotzuki-editor** (`tools/dotzuki-editor`) | 读写一切：项目清单、数据表、地图、场景、gfx。 |
| **`dotzuki` CLI** (`crates/dotzuki-cli`) | `dotzuki new` 生成项目骨架；`dotzuki check` 编译检查它的 DSL 文件。 |
| **`dotzuki run`** (`crates/dotzuki-cli` + `crates/dotzuki-runner`) | 启动项目并游玩：大地图、对话场景、warp（见下文）。 |

## 目录布局

```
my-game/
├── .dotzuki-editor.json     # project manifest — the only config file
├── README.md             # human notes; free-form
├── data/                 # dataRoot — game data
│   ├── maps/             # map definitions + per-map script .scene files
│   │   └── StartTown/    # editor-scaffolded demo map (map.tmx.json,
│   │                     #   tileset.png, script.scene, map.json)
│   ├── tiles/            # shared tile library (map-editor Backdrop/Trace)
│   └── stories/          # narrative bible: characters/, quests/, arcs/,
│                         #   graph.json (story activity)
├── gfx/                  # gfxRoot — graphics assets (tilesets, sprites)
└── assets/
    └── scenes/           # story scenes, Game DSL (.scene)
        └── main.scene    # starter scene
```

- `data/maps/` —— 每张地图一个条目。map 活动（`type: "map"`）通过 `mapsDir`
  （相对 `dataRoot`）指向这里；script 活动的 `scriptsDir` 按惯例也指向这里，
  这样每张地图的 `*.scene` 脚本就放在各自地图数据的旁边。
- `data/tiles/` —— 支撑地图编辑器 tile 选择器的共享 tile 库（活动
  `type: "tiles"`）。
- `gfx/` —— 散放的图形文件。assets 活动在 `roots` 中列出它。
- `assets/scenes/` —— 用游戏 DSL 编写的剧情场景。这是默认的**场景目录**
  （`game.scenesDir`）；见下文。

脚手架至少要创建：`.dotzuki-editor.json`、`README.md`、`data/maps/`、
`data/tiles/`、`gfx/`、`assets/scenes/main.scene`。带数据表的模板还会为每张表
额外创建一个 `data/<table.dir>/`。**编辑器的脚手架**还会额外种入入门内容，让
新项目开箱即可探索：一张带程序生成 tileset（`tileset.png`）和地图级
`script.scene` 的 `data/maps/StartTown/` 演示地图，`data/tiles/` 下种好的共享
tile 库，`data/stories/` 的 bible 骨架，以及——对于游戏模板（`dotzuki`、
`wuxia`）——示例表记录外加种好的剧情角色和任务。`dotzuki` 模板还**可开战**、
**可开店**：它的项目清单带一个 `battle` 区块（heroes 对 monsters，使用 spells
表——两个种好的 hero 组成可切换的队伍——外加一个含 3 瓶 Potion 的 `items` 块、
一个含种好的 Bug Catcher trainer 的 `encounters` 块，以及一个启用 EXP/等级成长
的 `levels` 块——种好的 Slime 获胜时给 8 EXP）、一个 `shop` 区块
（`{ "currency": "G", "startMoney": 100 }`）、种好的技能记录和战斗者的 `skills`
列表，以及一个 `data/rules.ron` type chart——新项目无需任何配置即可通过
`@command("startBattle", "slime")`（野怪）或
`@command("startBattle", "bug-catcher")`（trainer）开战，并通过
`@command("openShop", ["potion"])` 打开 Buy/Sell 商店（种好的 Potion 售价 20）。
`dotzuki new` 只生成最小骨架。

## 项目清单 schema（`.dotzuki-editor.json`）

顶层对象：

| 键 | 类型 | 必填 | 含义 |
|-----|------|----------|---------|
| `name` | string | yes | 显示名（自由格式，不必是 slug）。 |
| `dataRoot` | string | yes | 游戏数据根目录，相对项目目录。脚手架写入 `"./data"`。 |
| `gfxRoot` | string | no | 图形根目录，相对项目目录。默认 `"./gfx"`。 |
| `activities` | array | yes | 活动定义（见下文）。编辑器 UI 保留其顺序。 |
| `game` | object | no | 面向引擎的区块（见下文）。旧编辑器项目中没有。 |
| `battle` | object | no | 战斗系统区块（见[战斗规则](battle-rules.md)）。 |
| `shop` | object | no | 货币区块：`{ "currency": "G", "startMoney": 100 }`（两个键均可选，那些是默认值）。见[商店](#商店)。 |

### 活动

每个活动形如 `{ id, type, label, icon, enabled, config }`。`id` 在项目清单内
唯一；`type` 选择编辑器面板；`config` 是每个类型自由格式的对象（未知键会被
容忍）。脚手架生成的活动集合，按顺序：

| `id` | `type` | 关键 `config` 字段 |
|------|--------|---------------------|
| `maps` | `map` | `mapsDir`（相对 dataRoot），可选 `tileSize`、`blockSize` |
| `scripts` | `script` | `scriptsDir`（相对 dataRoot），`extension`（默认 `".scene"`） |
| `play` | `play` | 无（编辑器内 WASM 试玩——见[编辑器试玩](#编辑器试玩wasm-运行器)） |
| `data` | `data` | `tables`：`{ id, label, dir, icon, idField, fields[] }` 数组（表目录位于 dataRoot 之下） |
| `story` | `story` | `storiesDir`、`scenesDir`（均相对 dataRoot）、`locales` |
| `assets` | `assets` | `roots`（相对项目目录），可选 `extensions` |
| `tiles` | `tiles` | `tilesDir`、`tileSize`、`backdropMapsDir`（均相对 dataRoot） |

编辑器还定义了另一种活动类型，可能出现在手工搭建的项目中；脚手架不会生成它：

- `ui` —— GUI 布局。`config.guiRoot`（相对项目目录）存放 `.gui` 文件；
  `config.extension` 默认为 `".gui"`。

脚手架生成的 `story` 活动使用 `storiesDir: "stories"`、
`scenesDir: "maps"`（它的 `.scene` 文件所在处）和 `locales: ["en", "zh"]`。

### `game` 区块

可选。`dotzuki new` 会写入它；编辑器读写缺少它的项目也不会报错。

```json
"game": {
  "entryScene": "main",
  "scenesDir": "assets/scenes"
}
```

| 键 | 类型 | 缺省时的默认值 |
|-----|------|---------------------|
| `scenesDir` | string（相对项目目录） | `"assets/scenes"` |
| `entryScene` | string（`scenesDir` 下的场景文件名主干） | `scenesDir` 下发现的第一个 `.scene` 文件，按路径排序，去掉扩展名 |
| `entryMap` | string | map 活动的 `mapsDir` 下的第一个地图目录，按名称排序 |

消费方按以下顺序推导：解析 `scenesDir`（`game.scenesDir` 或默认值），扫描其中
的 `.scene` 文件，再取 `entryScene`——来自 `game.entryScene` 或第一个发现的
场景。`dotzuki new` 写入的 `"entryScene": "main"` 与脚手架生成的 `main.scene`
对应，因此新项目天然自洽。`dotzuki run` 如何使用这两个键，见下文说明。

## `dotzuki run` 的行为

`dotzuki run <dir>` 启动项目的一个可玩实例（窗口模式；CI/smoke 测试用
`--headless [--frames N] [--screenshot out.png]`）。它由 `dotzuki-runner`
crate 实现；本节是行为契约。

### 启动

加载项目清单，编译所有 DSL 目录（任何诊断信息都会让启动失败，并打印与
`dotzuki check` 相同的消息列表），编译后的场景按它们的 `game_scene` 名称注册。
入口解析：

- 有地图时：出生在 `game.entryMap`（或 `--map`），否则在 `mapsDir` 下的第一个
  地图目录。玩家出生在地图中央，向外扫描寻找第一个可行走的 tile。
- 无地图时：纯对话模式——`entryScene`（默认推导见[上文](#game-区块)）把它的
  `main` 剧情线运行到底，然后显示结束画面。

### 地图

一张地图由 `<mapsDir>/<id>/map.tmx.json`（Tiled JSON；名为 `collision` 的图层
标记阻挡 tiles，其余图层参与渲染）加上 `tileset.png`（全彩色 atlas，GID 从 1
开始、按行主序排列），再加上一个可选的 objects 伴生文件——`objects.json`（由
编辑器写入）组成，其中包含 `npcs: [{id,name,x,y,facing,sprite,talk}]`、
`warps: [{x,y,dest_map,dest_x,dest_y}]`、`signs: [{x,y,text}]`（面向告示牌 tile
并按 A，以分页对话的形式读出其文本），以及一个可选的 `encounters` 块（见下文）
（旧版 `map.json` 作为后备读取）。走上 warp tile 会淡出切换到目标地图。

这些文件的创作工作流见[地图](../how-to/maps.md)。

### 海拔层级

地图可以是多层的（既能在地面行走，*也能*在墙顶行走）。每层的碰撞：名为
`collision`（第 0 层）、`collision1`、`collision2`、…… 的图层——该层中非零
GID 即为实心；这些图层从不渲染。缺失的中间层视作全部实心。名为 `stairs` 的
图层标记过渡 tiles（从不渲染）：抵达时 GID 1 上升一层，GID 2 下降一层（限制在
地图的层数范围内）。视觉图层可携带一个可选的整数自定义属性 `level`（默认 0）：
`level <= player elevation` 的图层渲染在精灵下方，`level` 高于玩家海拔的图层
渲染在精灵上方。只有 `collision` 图层的地图与单层地图表现完全一致。

### 随机 encounters

地图通过在 objects 伴生文件中加入 `encounters` 块来开启野怪战斗——与 pokered
的 `wild_data` 结构相同：一个按步触发的 `rate` 字节，以 **/256** 为单位（`25`
≈ 每步 9.8%），加上若干 tile 矩形区域，每个区域各有一张加权表：

```json
"encounters": {
  "rate": 25,
  "zones": [
    { "x": 0, "y": 5, "w": 8, "h": 3,
      "table": [ { "id": "slime", "weight": 70 }, { "id": "bug-catcher", "weight": 30 } ] }
  ]
}
```

区域坐标以地图 tiles 为单位，矩形**包含**其 `w`×`h` 的范围。在区域内 tile 上
完成一步行走后掷骰一次：一个 rng 字节 `< rate` 即命中，随后从该区域的 `table`
做一次加权抽取选出 id（`weight` 是相对值，默认 1）。id 的解析与
`startBattle(id)` 完全一致——先解析 encounter 记录（包括 trainer 队伍/队列），
再解析单个敌人记录——并触发一场 **sceneless** 战斗（见
[战斗规则](battle-rules.md)）。步进结算优先级为：**warp > encounter 掷骰 >
普通行走**——走上 warp tile 从不掷骰，原地转身不算一步。`encounters` 缺失
（或为 `null`）⇒ 地图从不掷骰——旧的伴生文件保持原样继续工作。

### 场景分发

进入地图时：触发它的 `on_enter` 路由（来自编译报告中的 `@trigger`），否则触发
场景的 `<SceneName>OnLoad`，再否则触发它的 `main` 剧情线——只触发一次，由
`__played_main_<map>` 标志守护。与 NPC 对话（面向 + A）会运行其 `talk` 字段
指定的剧情线，否则运行以该 NPC 命名的路由，再否则运行地图场景的 `main`，再
否则把 `talk` 作为原始文本显示。一张地图的场景就是源文件为
`<mapsDir>/<map>/script.scene` 的已编译场景，后备为与地图同名的场景。

### 命令

场景 VM 完整支持 `showText`（分页文本框）、`showChoice`（菜单 → 索引）、
`warpTo`、`delay`、`fadeScreen`、flags（`setFlag`/`resetFlag`/`checkFlag`，
会话期间跨场景保持）、`startBattle`/`startWildBattle`（见
[战斗规则](battle-rules.md)）和 `openShop`（见[商店](#商店)）。任何其他命令
都会记录一条警告并自动完成，而不是让场景死锁。

### 菜单

在大地图上按 **Start** 会打开一个暂停菜单（按 B/Start 关闭；底下的大地图被
冻结），其中有四个条目：

- **Party** —— party 表每条记录的只读列表：名称、HP x/y、MP x/y、状态、基准
  属性（ATK/DEF/SPD）、元素和技能名。此版本不支持调整顺序。
- **Bag** —— 持久化背包（物品 → 数量）加上玩家的金钱。记录中 heal 数值为正的
  物品（与战斗物品相同的 `battle.items.healField` 约定）可以使用：选中物品，
  再选一名队伍成员——它回复（上限为最大 HP），数量减一。濒死的成员（0 HP）
  **不会**复活，满 HP 的成员不会被治疗（"It won't have any effect."），heal
  数值非正的物品无法使用。没有 `battle.items` 块的项目会把它们的物品列为不可
  用。
- **Save** —— 立即写入存档文件（同一个稳定状态写入器；从菜单存档总是允许的，
  即使在无头模式下运行也一样），并显示 "Game saved." 确认。
- **Close**（或 B）。

菜单文字跟随运行器的语言（`--lang en`/`zh`）。

### 商店

运行器持有玩家的**金钱**（一个 `u32`），初始值来自项目清单可选的顶层 `shop`
区块——`{ "currency": "G", "startMoney": 100 }`，该区块缺失时正是这些默认值
——并随存档文件（v3）保存。货币符号显示在商店 UI 和 Bag 中的金额旁边。场景用
`@command("openShop", ["potion", "elixir"])`（JS 中为 `game.openShop([...])`）
打开商店：场景挂起，商店 UI 在 **Buy / Sell / Exit** 根菜单上打开（在列表上
按 B 返回根菜单；在根菜单上按 B 或 Exit 恢复场景）。**Buy** 列出给定物品及其
记录中的 `price`（默认 0）和玩家的金钱。按 A 购买（money −= price，inventory
+= 1）；买不起的条目会被标记并拒绝。**Sell** 列出玩家背包中数量为正的条目，
每个按 **`floor(price / 2)`** 出售（没有单独的 sellPrice 字段；定价为 0 的
物品以 0 出售——允许）。按 A 卖出一个（money += ，count −= 1）。货架上未知的
物品 id 以 name=id、价格 0 的形式打开——配置错误的商店永远不会让场景死锁。
物品记录通过 `battle.items` 表读取。

### 游戏结束

输掉战斗不会再让玩家带着 0 HP 的队伍卡死：收到 `"lose"` 的场景结束（先播放它
自己的战败文本）后，运行器执行一次 **whiteout**——短暂黑屏，一行
`<Name> collapsed…`，然后整支队伍回复到满 HP/MP（状态清除），玩家回到**入口
地图的出生点**（若当前地图就是入口地图则留在原地，否则加载入口地图）。flags、
背包和金钱保留。无地图（纯对话）项目只做回复。目前还没有回复点系统：重生位置
总是入口出生点。

### 音频

`playMusic`/`playSound`/`stopMusic`/`fadeOutMusic` 播放
`data/audio/**/*.json` 中的音轨（dotzuki-audio `TrackDef` 格式；`music/` +
`sfx/` 子目录是惯例——目录树会递归加载）。场景传入的 id 是音轨的 `id` 字段；
未知 id 警告一次后继续。音频完全是可选的：没有 `data/audio/` 目录意味着每条
命令都是零设备开销的静默空操作，输出设备在第一条播放命令时才惰性打开，设备
缺失/不可用（CI、`--headless`）时记录一次并保持静默。音频文件不会被 `--watch`
热重载（它们在启动时加载）。

### 精灵

玩家在存在 `gfx/overworld/player/sheet.png`（24×32 单元格，4 个朝向 × 5 帧）
时使用它；否则绘制一个程序生成的占位小人。此版本中 NPC 一律渲染为以 id 着色
的占位图形。

### 存档/读档

游戏存档写入 `<project>/.dotzuki-save.json`（可用 `--save-file` 覆盖）——带
版本号的 JSON：`{version, map, player: {x, y, facing, level?}, flags, lang,
party?, inventory?, money?}`（v3；`party`/`inventory` 在战斗完成后才出现——见
[战斗规则](battle-rules.md)；当战斗有 `levels` 块时，队伍成员可携带可选的
`level`/`exp` 字段——缺失 ⇒ 等级 1 / 0 EXP；`money` 总是写入；`player.level`
是地图海拔层，缺失 ⇒ 0）。存档只从**稳定**状态写入——完成一次 warp 过渡之后，
以及场景结束回到大地图时——绝不在场景中途或 warp 中途写入（挂起的场景引擎
无法恢复），因此在对话中途关掉窗口会保留最后一个稳定点。Start 菜单的
**Save** 条目按需写入同一个文件（总是允许，即使在无头模式运行中）。启动时若
存在有效存档则恢复：flags 恢复，已存档的地图加载，玩家被放在已存档的 tile 上
（若该 tile 被占用则退回出生点扫描），队伍状态、背包和金钱随之恢复，并跳过
开场分发——恢复的 `__played_main_*` flags 让 `main` 不会在之后的进入时重播。
加载接受任何 `<=` 当前版本的存档，并按字段给默认值——**v1/v2 存档仍然能恢复**
（没有 `party`/`inventory` ⇒ 两者从零开始；没有 `money` ⇒ 采用项目清单
`shop.startMoney` 的默认值）；缺失/损坏/**更新**版本的存档会警告并以全新状态
启动。`--fresh` 忽略存档；`--map` 覆盖存档中的地图。窗口模式运行总是写入
存档；`--headless` 除非传入 `--save`，否则从不写入（CI 保持无副作用）。

围绕该格式的兼容性规则见[存档兼容性](../explanation/save-compatibility.md)。

### 热重载

使用 `--watch`（仅窗口模式）时，运行中的游戏会监视 data/gfx/scene 目录：编辑
`.scene` 会重新编译 DSL 并原地替换场景（编辑出错时旧场景继续运行；诊断信息会
记录到日志），编辑*当前*地图的 `map.tmx.json` / `tileset.png` / objects 伴生
文件会原地重载该地图，保留玩家位置和 flags。其他地图、数据表和 gfx 在下次
进入 / 启动时生效。

### 尚未实现

依赖以下内容的场景会警告并继续：`StackDriver` 回合循环。

## `dotzuki check` 编译什么

`dotzuki check <dir>` 加载项目清单，收集所有可能存放 DSL 文件的目录，并对它们
运行 `dotzuki_engine_dsl::compiler::compile_dirs`（在内存中运行，不写出任何
产物）。目录集合为：

1. 场景目录（`game.scenesDir`，默认 `assets/scenes`，相对项目目录）；
2. 每个 `script` 活动的 `scriptsDir`（相对 dataRoot）；
3. 每个 `story` 活动的 `scenesDir`（相对 dataRoot，默认 `"maps"`）；
4. 每个 `ui` 活动的 `guiRoot`（相对项目目录）。

重复目录会被去重；不存在的目录会被跳过（因此没有 `assets/scenes/` 的旧项目
仍会检查它 data-root 下的场景）。`check` 打印产物计数（`N scene(s), M
layout(s), …`）和所有诊断信息，出现任何诊断信息时退出码为 1，否则为 0。

当项目清单带 `battle` 区块时，`check` 还会校验它：引用的表 id
（party/enemies/encounters/skills/items）必须存在于 data 活动的
`config.tables[]` 中，引用的属性/技能字段和物品的 `healField` 必须存在于表
schema 中，`encounters` 块的表必须声明 `enemies` 字段，并且规则文件（磁盘上
存在时）必须能按 dotzuki-rules `Ruleset` 模型解析，且能对着封闭词汇表编译
通过——hook 中未知的事件、op，或属性/类型/资源/状态名都会产生诊断信息，就像
它会在战斗开始时成为启动错误一样。
战斗诊断信息与 DSL 诊断信息一样打印，并让退出码失败。
记录 JSON 不会被加载——项目清单的表定义就够了。

## 编辑器试玩（WASM 运行器）

编辑器的 `play` 活动通过 `crates/dotzuki-runner-web`（wasm-bindgen）在
**浏览器中**运行同一个 `RunnerGame`，因此试玩不需要 Rust 工具链。与运行器的
契约：

- **Bundle。** `GET /api/play/bundle` 返回整个项目，形如
  `{ files: { "<project-relative posix path>": "<base64>" }, projectRoot }`，
  排除 `node_modules`/`.git`/`target`/`dist`、`*.bak` 以及除
  `.dotzuki-editor.json` 之外的 dotfiles（上限为 16 MB/文件、64 MB 总量）。
  路径保持 `data/maps/<id>/script.scene` 的形式，这正是运行器场景 ↔ 地图匹配
  所期望的。
- **Boot。** bundle 喂给 `vfs::MemoryFiles` 和 `LoadedProject::load_with_files`
  ——与 `dotzuki run` 完全相同的启动路径，不经过磁盘。`RunnerOptions` 强制
  `watch=false`、无头模式（无音频设备）、`pcm_audio=true` 且不写磁盘存档。
- **Frames。** 页面以约 59.7 Hz 调用 `tick(input_bitmask)`，并把返回的 320×240
  RGBA 帧 blit 上屏。输入位掩码与 `GbButton` 位序一致（bit0=A … bit7=Down）。
- **Audio。** 运行器不使用 cpal 设备，而是每 tick 渲染 APU PCM
  （`RunnerGame::render_audio`，44.1 kHz 立体声 f32）；页面通过 `take_audio()`
  把它排入 WebAudio 队列（`usePlayAudio`）。与原生相同的 sequencer/fade 路径，
  用拉取模型取代回调线程。
- **Saves。** `export_save()`/`import_save(json)` 取代 `.dotzuki-save.json`；
  编辑器把它们持久化到 `localStorage`。场景/战斗/商店/warp 过渡挂起期间，
  `export_save` 不返回任何内容——编辑器在自己的间隔里重试即可。

与原生 `dotzuki run` 的差异：没有文件监视（编辑器的 **Restart** 按钮重新拉取
bundle 并重启，同时恢复存档），音频输出经由浏览器的 `AudioContext` 而非 cpal
设备，战斗 RNG 的种子不取自墙上时钟时间。其余一切——地图、对话、选项、战斗、
商店、菜单、游戏结束流程——都是同一套代码。
