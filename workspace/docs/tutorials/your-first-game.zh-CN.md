# 你的第一个游戏 — 城镇、战斗、剧情与存档

> 本文是 `tutorials/your-first-game.md` 的中文翻译，同步至引擎版本 v0.1.0（源文档 commit 3133fb419ae3bc6e5c08bbbcd43ac7fa0289e44f）。
> 内容以英文源为准；发现不一致请更新英文源再同步翻译。

> - **Audience**: game authors
> - **Type**: tutorial
> - **Status**: active
> - **Last verified**: v0.1.0

逐步构建仓库里已提交的
[`examples/your-first-game/`](../../examples/your-first-game/) 项目：一个有 NPC 向导的
城镇、一场由剧情触发的战斗、一片高草丛会随机遭遇野怪的空地，以及一份存档 —— 全部用数
据编写，不写 Rust。

开始前，请先完成[快速入门](quickstart.md)，并把 `dotzuki` 可执行文件放到 PATH 上。在
`workspace/` 下构建一次即可：

```bash
cd workspace
cargo build --release --bin dotzuki
```

产物位于 `target/release/dotzuki`。

目标就是已提交的项目本身：一个可玩的城镇、一场由剧情触发的战斗、一片随机遭遇的空地和
一份存档。下文每个清单都是该项目的拷贝，所以每一步结束时都处于下一步可以继续的状态。
两个 `map.tmx.json` 清单用带 `<!-- excerpt -->` 标记的注释缩写了自己的 tile 数组；请从
已提交的项目中复制完整的数组。

## 1. 搭建项目骨架

```bash
dotzuki new your-first-game
cd your-first-game
```

`dotzuki new` 会[脚手架](../reference/glossary.md)（scaffold）出一个
[零 Rust 项目](../reference/glossary.md) —— 一个引擎和编辑器直接按原样消费的普通目录。
它写出的结构：

- `.dotzuki-editor.json` —— [项目清单](../reference/glossary.md)（manifest）：七个编辑
  器活动、一个空的 `tables` 列表，以及一个 `game` 区块。
- `data/maps/` —— 每张地图一个目录；目前为空。
- `data/tiles/` —— 共享 tile 库；这个游戏用不到，保持为空。
- `data/stories/` —— 叙事圣经骨架；这个游戏用不到，保持为空。
- `gfx/` —— 图形资源。
- `assets/scenes/main.scene` —— 一个用[游戏 DSL](../reference/glossary.md) 编写的入门
  [场景](../reference/glossary.md)；第 6 步会替换它。
- `README.md` —— 自由格式的笔记。

## 2. 项目清单

用下面的文件替换脚手架生成的 `.dotzuki-editor.json`：

```json
{
  "name": "Your First Game",
  "dataRoot": "./data",
  "gfxRoot": "./gfx",
  "activities": [
    {
      "id": "maps",
      "type": "map",
      "label": "Maps",
      "icon": "map",
      "enabled": true,
      "config": {
        "mapsDir": "maps"
      }
    },
    {
      "id": "scripts",
      "type": "script",
      "label": "Scripts",
      "icon": "code",
      "enabled": true,
      "config": {
        "extension": ".scene",
        "scriptsDir": "maps"
      }
    },
    {
      "id": "play",
      "type": "play",
      "label": "Play",
      "icon": "play",
      "enabled": true,
      "config": {}
    },
    {
      "id": "data",
      "type": "data",
      "label": "Data",
      "icon": "database",
      "enabled": true,
      "config": {
        "tables": [
          {
            "id": "heroes",
            "label": "Heroes",
            "dir": "heroes",
            "icon": "user",
            "idField": "id",
            "fields": [
              { "id": "name", "label": "Name", "type": "string" },
              { "id": "hp", "label": "HP", "type": "number" },
              { "id": "atk", "label": "Attack", "type": "number" },
              { "id": "def", "label": "Defense", "type": "number" },
              { "id": "spd", "label": "Speed", "type": "number" },
              { "id": "mp", "label": "MP", "type": "number" },
              { "id": "element", "label": "Element", "type": "string" },
              { "id": "skills", "label": "Skills", "type": "list" }
            ]
          },
          {
            "id": "monsters",
            "label": "Monsters",
            "dir": "monsters",
            "icon": "bug",
            "idField": "id",
            "fields": [
              { "id": "name", "label": "Name", "type": "string" },
              { "id": "hp", "label": "HP", "type": "number" },
              { "id": "atk", "label": "Attack", "type": "number" },
              { "id": "def", "label": "Defense", "type": "number" },
              { "id": "spd", "label": "Speed", "type": "number" },
              { "id": "mp", "label": "MP", "type": "number" },
              { "id": "element", "label": "Element", "type": "string" },
              { "id": "skills", "label": "Skills", "type": "list" }
            ]
          },
          {
            "id": "encounters",
            "label": "Encounters",
            "dir": "encounters",
            "icon": "crosshair",
            "idField": "id",
            "fields": [
              { "id": "name", "label": "Name", "type": "string" },
              { "id": "enemies", "label": "Enemies", "type": "list" },
              { "id": "trainer", "label": "Trainer", "type": "boolean" },
              { "id": "money", "label": "Money", "type": "number" }
            ]
          },
          {
            "id": "spells",
            "label": "Spells",
            "dir": "spells",
            "icon": "sparkles",
            "idField": "id",
            "fields": [
              { "id": "name", "label": "Name", "type": "string" },
              { "id": "type", "label": "Category", "type": "string" },
              { "id": "power", "label": "Power", "type": "number" },
              { "id": "accuracy", "label": "Accuracy", "type": "number" },
              { "id": "element", "label": "Element", "type": "string" },
              { "id": "stat", "label": "Stat", "type": "string" },
              { "id": "mpCost", "label": "MP Cost", "type": "number" }
            ]
          },
          {
            "id": "items",
            "label": "Items",
            "dir": "items",
            "icon": "package",
            "idField": "id",
            "fields": [
              { "id": "name", "label": "Name", "type": "string" },
              { "id": "healHp", "label": "Heal HP", "type": "number" },
              { "id": "price", "label": "Price", "type": "number" },
              { "id": "effect", "label": "Effect", "type": "string" }
            ]
          }
        ]
      }
    },
    {
      "id": "story",
      "type": "story",
      "label": "Story",
      "icon": "book",
      "enabled": true,
      "config": {
        "locales": [
          "en",
          "zh"
        ],
        "scenesDir": "maps",
        "storiesDir": "stories"
      }
    },
    {
      "id": "assets",
      "type": "assets",
      "label": "Assets",
      "icon": "image",
      "enabled": true,
      "config": {
        "roots": [
          "gfx"
        ]
      }
    },
    {
      "id": "tiles",
      "type": "tiles",
      "label": "Tiles",
      "icon": "tiles",
      "enabled": true,
      "config": {
        "backdropMapsDir": "maps",
        "tileSize": 16,
        "tilesDir": "tiles"
      }
    }
  ],
  "game": {
    "entryScene": "main",
    "entryMap": "Hometown",
    "scenesDir": "assets/scenes"
  },
  "battle": {
    "party": { "table": "heroes" },
    "enemies": { "table": "monsters" },
    "encounters": { "table": "encounters" },
    "skills": { "table": "spells", "field": "skills", "categoryField": "type", "costField": "mpCost" },
    "stats": { "hp": "hp", "attack": "atk", "defense": "def", "speed": "spd" },
    "resource": "mp",
    "rules": "data/rules.ron",
    "items": { "table": "items", "healField": "healHp", "starting": { "potion": 3 } }
  },
  "shop": { "currency": "G", "startMoney": 100 }
}
```

这里起作用的顶层区块有五个：

- `activities` —— 七个编辑器[活动](../reference/glossary.md)（Maps、Scripts、Play、
  Data、Story、Assets、Tiles）。`maps` 把地图活动指向 `dataRoot` 下的 `maps`；
  `scripts` 把脚本活动指向同一个 `maps` 目录、扩展名 `.scene`，于是每张地图的场景文
  件都紧挨着自己的地图。`data` 活动声明五张[数据表](../reference/glossary.md)：每条
  `tables[]` 配置给出 `dir`、`idField` 和编辑器渲染成表单的字段模式。`story` 声明双语
  locales，并把 `scenesDir` 指向 `maps`；`assets` 把资源面板的根目录设为 `gfx`；
  `tiles` 配置 tile 库面板。
- `game` —— 面向引擎的区块。`entryScene: "main"` 指定 `scenesDir` 下用于无地图项目的
  场景；`entryMap: "Hometown"` 是 `dotzuki run` 出生所在的
  [入口地图](../reference/glossary.md)；`scenesDir: "assets/scenes"` 是场景目录。
- `battle` —— 启用数据驱动的战斗系统。`party` 与 `enemies` 指定双方战斗者的数据表
  （`heroes` 对 `monsters`）；`encounters` 指定 encounter 表；`skills` 指定 `spells` 表
  及字段名 —— `field: "skills"` 是战斗者记录上的技能列表，`categoryField: "type"` 与
  `costField: "mpCost"` 分别指定类别列和 MP 消耗列；`stats` 把四个角色位（`hp`、
  `attack`、`defense`、`speed`）映射到记录字段；`resource: "mp"` 指定 MP 池字段；
  `rules: "data/rules.ron"` 指向规则文件（第 4 步）；`items` 指定道具表、它的
  `healField: "healHp"`，以及 3 瓶药水的初始背包。
- `shop` —— `currency: "G"` 与 `startMoney: 100`：运行器持有的金钱，显示在背包和商店
  界面里，并随存档保存。

## 3. 数据表

每张数据表的目录下每个记录一个 JSON 文件，位于 `data/<dir>/`、命名为 `<id>.json`。
创建这九个文件。

### 英雄

`data/heroes/aria.json` —— [队伍](../reference/glossary.md)（party）就是 `heroes` 表的
全部记录，所以 Aria 一人带队：

```json
{
  "id": "aria",
  "name": "Aria",
  "hp": 60,
  "atk": 12,
  "def": 10,
  "spd": 15,
  "mp": 20,
  "element": "grass",
  "skills": ["slash", "fire-bolt", "bubble", "heal"]
}
```

四个[属性](../reference/glossary.md)（stat）`hp`、`atk`、`def`、`spd` 通过
`battle.stats` 映射。`mp` 是 `battle.resource` 指定的资源池 —— Fire Bolt 和 Heal 从中
消耗。`element: "grass"` 是 Aria 的[元素](../reference/glossary.md)，在
[克制表](../reference/glossary.md)（type chart）查询中充当防守方。`skills` 列出 Aria
在战斗中可用的 `spells` 表[技能](../reference/glossary.md) id。

### 怪物

`data/monsters/slime.json` 与 `data/monsters/goblin.json` —— 敌方记录，字段与英雄相
同：

```json
{
  "id": "slime",
  "name": "Slime",
  "hp": 40,
  "atk": 8,
  "def": 8,
  "spd": 5,
  "mp": 0,
  "element": "grass",
  "skills": ["slash"]
}
```

```json
{
  "id": "goblin",
  "name": "Goblin",
  "hp": 55,
  "atk": 10,
  "def": 9,
  "spd": 9,
  "mp": 0,
  "element": "fire",
  "skills": ["slash"]
}
```

史莱姆是 grass，哥布林是 fire —— 第 4 步的克制表行让 Fire Bolt 打史莱姆 ×2、Bubble
打哥布林 ×2。两者只会 Slash，`mp: 0` 意味着没有 MP 池，而它们唯一的技能也不需要 MP。

### Encounters

`data/encounters/rival.json` —— 一条 [encounter](../reference/glossary.md) 记录：

```json
{
  "id": "rival",
  "name": "Rival Kai",
  "enemies": ["goblin"],
  "trainer": true,
  "money": 50
}
```

`enemies` 是敌方依次派出的有序队列；`trainer: true` 使它成为
[trainer 战斗](../reference/glossary.md) —— 不能逃跑，获胜获得 `money: 50` G。这个游
戏没有场景调用 `rival`；该记录演示了模式，留给之后的剧情线使用。向导的战斗开局用的
是野生 `slime` 记录（第 6 步）。

### 技能

`data/spells/fire-bolt.json`、`data/spells/slash.json`、`data/spells/bubble.json`、
`data/spells/heal.json`：

```json
{
  "id": "fire-bolt",
  "name": "Fire Bolt",
  "type": "attack",
  "power": 50,
  "accuracy": 100,
  "element": "fire",
  "mpCost": 5
}
```

```json
{
  "id": "slash",
  "name": "Slash",
  "type": "attack",
  "power": 40,
  "accuracy": 100,
  "mpCost": 0
}
```

```json
{
  "id": "bubble",
  "name": "Bubble",
  "type": "attack",
  "power": 40,
  "accuracy": 100,
  "element": "water",
  "mpCost": 4
}
```

```json
{
  "id": "heal",
  "name": "Heal",
  "type": "heal",
  "power": 25,
  "accuracy": 100,
  "mpCost": 4
}
```

`type` 是类别列（`battle.skills.categoryField`）：`attack` 按标准公式造成伤害，
`heal` 为使用者自己恢复 `power` 点 HP，上限封顶。`element` 参与克制表 —— Fire Bolt 是
fire，Bubble 是 water；Slash 和 Heal 没有元素，因此没有克制表行适用于它们。`mpCost`
是消耗列（`battle.skills.costField`）：Fire Bolt 消耗 5 MP，Heal 消耗 4，Slash 免费。
`accuracy: 100` 一定命中。公式和回合循环见
[战斗规则参考](../reference/battle-rules.md)。

### 道具

`data/items/potion.json`：

```json
{
  "id": "potion",
  "name": "Potion",
  "healHp": 20,
  "price": 20,
  "effect": "Restores 20 HP."
}
```

`healHp: 20` 是 `battle.items.healField` —— 正数让道具在战斗中和暂停菜单的背包里可
用，每次使用恢复 20 HP，上限封顶。`price: 20` 是商店的购买价格。`effect` 是仅用于展
示的说明文字。

## 4. 规则文件

`data/rules.ron` —— 声明式战斗规则，由 `dotzuki-rules` 解析：

```ron
// rules.ron — Your First Game's battle ruleset. The runner consumes the
// type chart only; stats/types/resources are declared so the file is a
// valid dotzuki-rules Ruleset (see reference/battle-rules.md).
Ruleset(
    stats: ["hp", "atk", "def", "spd"],
    types: ["fire", "grass", "water"],
    resources: ["mp"],
    type_chart: [
        (atk: "fire", def: "grass", mult: [2, 1]),
        (atk: "grass", def: "fire", mult: [1, 2]),
        (atk: "water", def: "fire", mult: [2, 1]),
    ],
)
```

[运行器](../reference/glossary.md)（runner）从 `battle.rules` 指定的路径加载这个
[RON](../reference/glossary.md) 文件，读取 `type_chart`：每一行把攻击技能的 `element`
与防守方的 `element` 配对，`mult: [num, den]` 是有理数倍率 —— `[2, 1]` 把伤害放大 ×2
（效果拔群），`[1, 2]` 缩小到 ×½（被抵抗）。克制表中没有的组合保持 ×1。Fire Bolt 打
grass 的史莱姆是 ×2，Bubble 打 fire 的哥布林是 ×2，grass 技能打 fire 目标是 ×½。

`stats`、`types` 和 `resources` 声明封闭词表，让文件解析为合法的 `dotzuki-rules`
`Ruleset` —— `dotzuki check` 遇到未知名称会报错。这个游戏没有声明 `effects`，所以克
制表是唯一生效的部分；带 `effects` 的规则文件会编译成运行时
[效果栈](../reference/glossary.md)（effect stack）（见
[战斗规则参考](../reference/battle-rules.md)）。

## 5. 城镇地图

创建 `data/maps/Hometown/`，放入三个文件：`map.tmx.json`、`tileset.png` 和
`objects.json`。

`map.tmx.json` 是 Tiled JSON：20 × 15 个 [tile](../reference/glossary.md)，每个
8 × 8 像素。`ground` 和 `decoration` 图层会渲染；`collision` 图层从不渲染，并挡住每
个 GID 非零的 tile。[GID](../reference/glossary.md) 从 1 开始、按行编入
[tileset](../reference/glossary.md) 图集，图集由 `tilesets` 块声明 —— `tileset.png`，
32 × 8 像素，四张 tile，`columns: 4`。

```json
{
  "width": 20,
  "height": 15,
  "tilewidth": 8,
  "tileheight": 8,
  "backgroundcolor": "#306850",
  "layers": [
    {
      "name": "ground",
      "width": 20,
      "height": 15,
      <!-- excerpt: `data` is 300 GIDs (20 rows × 20). GID 1 fills the map, GID 4
           marks the path column (x=10) and the cross row (y=7). The full array
           lives in examples/your-first-game/data/maps/Hometown/map.tmx.json. -->
      "data": [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 4, 1, 1, 1, 1, 1, 1, 1, 1, 1, ...],
      "visible": true,
      "opacity": 1.0
    },
    {
      "name": "decoration",
      "width": 20,
      "height": 15,
      <!-- excerpt: `data` is 300 GIDs (20 rows × 20). Mostly 0; GID 2 trees dot
           the field. The full array lives in
           examples/your-first-game/data/maps/Hometown/map.tmx.json. -->
      "data": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, ...],
      "visible": true,
      "opacity": 1.0
    },
    {
      "name": "collision",
      "width": 20,
      "height": 15,
      <!-- excerpt: `data` is 300 GIDs (20 rows × 20). A GID-1 ring borders the
           map; 0 inside, so the warp tile (18, 7) stays walkable. The full
           array lives in examples/your-first-game/data/maps/Hometown/map.tmx.json. -->
      "data": [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, ...],
      "visible": false,
      "opacity": 1.0
    }
  ],
  "tilesets": [
    {
      "firstgid": 1,
      "name": "demo",
      "tilewidth": 8,
      "tileheight": 8,
      "tilecount": 4,
      "image": "tileset.png",
      "imagewidth": 32,
      "imageheight": 8,
      "columns": 4
    }
  ]
}
```

`data` 数组各含 300 项（20 行 × 20 列）；清单为每个图层展示有代表性的一行，并带
`<!-- excerpt -->` 标记。完整数组请从
`examples/your-first-game/data/maps/Hometown/map.tmx.json`
复制。`ground` 全部铺 GID 1，其中 GID-4 路径列（x=10）和整行 GID-4 的横贯行（y=7）；
`decoration` 撒下 GID-2 的树；`collision` 用 GID 1 围住地图边界，内部 —— 包括传送点
tile（18, 7）—— 保持可行走。

把图集复制进来（两张地图共用）：

```bash
cp <repo>/workspace/dotzuki-template/assets/tileset.png data/maps/Hometown/tileset.png
```

把 `<repo>` 替换为本仓库的路径。

`objects.json` 是地图的[伴生文件](../reference/glossary.md)（sidecar）—— 地图上摆放
的[实体](../reference/glossary.md)（entity）：

```json
{
  "npcs": [
    {
      "id": 1,
      "name": "Guide",
      "x": 12,
      "y": 7,
      "facing": "down",
      "talk": "guide_talk"
    }
  ],
  "warps": [
    { "x": 18, "y": 7, "dest_map": "Clearing", "dest_x": 2, "dest_y": 5 }
  ],
  "signs": [
    { "x": 3, "y": 3, "text": "Hometown — every journey starts here." }
  ]
}
```

向导 NPC 站在 (12, 7)、面朝下；它的 `talk` 字段指定玩家面朝它并按 A 时运行的剧情线。
[传送点](../reference/glossary.md)（warp）(18, 7) 把玩家淡出到 `Clearing` 地图，到达
tile (2, 5)。路牌在 (3, 3)，玩家面朝它并按 A 时以分页对话显示文本。

## 6. 场景

替换 `assets/scenes/main.scene`，然后创建 `data/maps/Hometown/script.scene`。

一个[场景](../reference/glossary.md)就是一份由
[剧情线](../reference/glossary.md)（storyline）组成的 `game_scene` 文档。`main.scene`
装着无名的 `@storylines` 块 —— 即 `main` 剧情线：

```dsl
game_scene Main {
    @storylines {
        @speaker("Guide") {
            "Welcome to Your First Game!"
            "Talk to the Guide in Hometown, then find the warp to the Clearing."
        }
    }
}
```

项目清单的 `game.entryScene: "main"` 为无地图项目指定这个文件。有地图时，
`game.entryMap` 优先：`dotzuki run` 出生在 Hometown，由地图自己的场景驱动它，所以
`main.scene` 维持着 `scenesDir` 的契约。

`script.scene` 紧挨着地图，这个位置本身就是绑定：运行器把地图的场景解析为
`<mapsDir>/<map>/script.scene`。Hometown 的场景有两条命名剧情线：

```dsl
game_scene Hometown {
    @storyline("hometown_intro") {
        @trigger(map = "Hometown", on_enter = true)
        @speaker("Guide") {
            "Welcome to Hometown, Aria!"
            "The warp on the east edge leads to the Clearing."
            "Wild monsters roam the tall grass there — a good place to train."
        }
    }

    @storyline("guide_talk") {
        @trigger(map = "Hometown", npc = "Guide")
        @speaker("Guide") {
            "You look ready for your first fight."
            "Want to try one right here?"
        }
        @choice {
            @option("Let's fight!") {
                result = startBattle("slime")
                @if (result == "win") {
                    @speaker("Guide") {
                        "Well fought! Fire beats grass, remember that."
                    }
                    @command("setFlag", "WON_GUIDE_BATTLE")
                } @else {
                    @speaker("Guide") {
                        "It happens. Heal up and try again."
                    }
                }
            }
            @option("Not yet.") {
                @speaker("Guide") {
                    "Come back when you are ready."
                }
            }
        }
    }
}
```

- `hometown_intro` 带一个 `on_enter = true` 的
  [触发器](../reference/glossary.md)（trigger）—— 地图加载时运行器会触发它。
- `guide_talk` 带 `npc = "Guide"`，是指向这个 NPC 的路由 —— 而 NPC 的 `talk` 字段指
  定同一条剧情线；与向导对话就会运行它。
- `@choice` 把两个 `@option` 呈现为菜单。
- `result = startBattle("slime")` 挂起场景，对 `slime` 记录开一场
  [野怪战斗](../reference/glossary.md)；场景恢复时 `result` 被设为 `"win"`、`"lose"`
  或 `"run"`。
- `@if (result == "win")` 按结果分支；获胜分支用一条
  [命令](../reference/glossary.md)（command）设置 [flag](../reference/glossary.md)
  `WON_GUIDE_BATTLE`。flag 在本次会话中跨场景保持，并随存档保存。

## 7. 空地

用同样的方式创建 `data/maps/Clearing/` —— 一张更小的 12 × 10 地图：

```json
{
  "width": 12,
  "height": 10,
  "tilewidth": 8,
  "tileheight": 8,
  "backgroundcolor": "#306850",
  "layers": [
    {
      "name": "ground",
      "width": 12,
      "height": 10,
      <!-- excerpt: `data` is 120 GIDs (10 rows × 12). GID 1 fills the map, GID 4
           marks the tall-grass patch (x=5–6, y=2–7). The full array lives in
           examples/your-first-game/data/maps/Clearing/map.tmx.json. -->
      "data": [1, 1, 1, 1, 1, 4, 4, 1, 1, 1, 1, 1, ...],
      "visible": true,
      "opacity": 1.0
    },
    {
      "name": "collision",
      "width": 12,
      "height": 10,
      <!-- excerpt: `data` is 120 GIDs (10 rows × 12). A GID-1 border rings the
           map; the west wall opens at (0, 4) so the return warp tile stays
           walkable. The full array lives in
           examples/your-first-game/data/maps/Clearing/map.tmx.json. -->
      "data": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, ...],
      "visible": false,
      "opacity": 1.0
    }
  ],
  "tilesets": [
    {
      "firstgid": 1,
      "name": "demo",
      "tilewidth": 8,
      "tileheight": 8,
      "tilecount": 4,
      "image": "tileset.png",
      "imagewidth": 32,
      "imageheight": 8,
      "columns": 4
    }
  ]
}
```

`ground` 铺 GID 1，其中 GID-4 高草丛在（x=5–6，y=2–7）；`collision` 围住地图边界，
并在 (0, 4) 打开西墙，让返回传送点的 tile 保持可行走。完整数组请从
`examples/your-first-game/data/maps/Clearing/map.tmx.json`
复制。

```bash
cp <repo>/workspace/dotzuki-template/assets/tileset.png data/maps/Clearing/tileset.png
```

`objects.json` 增加了 `encounters` 块 —— 地图的遭遇侧：

```json
{
  "warps": [
    { "x": 0, "y": 4, "dest_map": "Hometown", "dest_x": 17, "dest_y": 7 }
  ],
  "encounters": {
    "rate": 60,
    "zones": [
      {
        "x": 1,
        "y": 1,
        "w": 10,
        "h": 8,
        "table": [
          { "id": "slime", "weight": 60 },
          { "id": "goblin", "weight": 40 }
        ]
      }
    ]
  }
}
```

`rate: 60` 是每步概率，以 /256 为单位：完成一步走进区域 tile 时抽一个字节，值小于
60（约 23%）即触发战斗。每个 `zones` 矩形（`x`、`y`、`w`、`h`）是一个含边界的 tile
范围；命中后按权重从该区域的 `table` 抽 id —— Slime 60、Goblin 40。id 的解析与
`startBattle(id)` 相同，开一场 [sceneless 战斗](../reference/glossary.md)：获胜或逃跑
后回到遭遇 tile 处的大地图；失败触发 [whiteout](../reference/glossary.md) —— 队伍回
满，玩家回到[入口地图](../reference/glossary.md)的
[出生点](../reference/glossary.md)（spawn）。返回传送点在 (0, 4)，落到 Hometown
(17, 7)，即东边传送点西侧一格。

场景用[旁白](../reference/glossary.md)（narrator form）宣告这个地方 ——
`@speaker("")` 渲染不带名字前缀的台词：

```dsl
game_scene Clearing {
    @storyline("clearing_enter") {
        @trigger(map = "Clearing", on_enter = true)
        @speaker("") {
            "Tall grass rustles all around. Wild monsters prowl here."
        }
    }
}
```

## 8. 运行它

编译检查所有 DSL 目录并校验战斗区块：

```bash
dotzuki check .
```

退出码为 0 表示场景编译通过、战斗接线 —— 表 id、字段名和 `data/rules.ron` —— 校验
通过。

开窗口玩：

```bash
dotzuki run .
```

操作：**Arrows/WASD** 移动，**Z** 确认/对话，**X** 取消/跑步，**Enter/Space** 打开暂
停菜单，**Backspace** 是 Select。游玩路线：读路牌，与向导对话并选 **Let's fight!**
—— Aria 对战野生史莱姆，Fire Bolt 打出 ×2（fire 克制 grass），获胜后设置
`WON_GUIDE_BATTLE`。踏上东边传送点去 Clearing；在高草丛区域走动会触发遭遇；走西边传
送点回家。暂停菜单里有 **Party**、**Bag** 和 **Save**。

CI 和截图用[无头模式](../reference/glossary.md)（headless）运行同一个游戏 —— 不开窗
口：

```bash
dotzuki run . --headless --frames 180
```

`--frames 180` 模拟 180 帧 —— 本仓库 CI 跑的就是这个
[冒烟测试](../reference/glossary.md)（smoke test）。无头运行默认不写存档，除非加
`--save`；`--screenshot shot.png` 导出最后一帧：

```bash
dotzuki run . --headless --frames 180 --save --screenshot shot.png
```

`--lang zh` 把运行器自己的标签（暂停菜单、存档确认）切换成中文；场景文本用
[`@t("en", "中文")`](../reference/glossary.md)（双语文本语法）编写时也会跟随切换。

存档落在项目目录的 `.dotzuki-save.json` ——
[存档版本](../reference/glossary.md)（save version）3，包含地图、玩家 tile 与朝向、
flag、队伍状态、背包和金钱。存档只在稳定点写入 —— 传送切换完成之后、场景结束回到
[大地图](../reference/glossary.md)（overworld）之时 —— 所以对话途中关窗会保留最后一
个稳定点。窗口运行总是写存档；`--fresh` 忽略已有存档、全新开局。

## 接下来读什么

- **地图** —— [地图制作指南](../how-to/maps.md)：海拔、实体、遭遇、tileset。
- **战斗** —— [战斗规则指南](../how-to/battles.md)与
  [战斗规则参考](../reference/battle-rules.md)：效果、特性、携带道具、天气。
- **项目清单契约** —— [项目清单](../reference/project-manifest.md)：`dotzuki run` 和
  `dotzuki check` 承诺的行为。
- **编辑器路径** —— [editor-first-game.md](./editor-first-game.md)：通过
  dotzuki-editor 和 AI Story Designer 做同一个游戏。
