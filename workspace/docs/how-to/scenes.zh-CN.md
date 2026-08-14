# 场景

如何编写 `.scene` 剧情文件：NPC 对话、进图过场、选项、flag、场景内战斗，以及编写-检查循环。

> 本文是 `how-to/scenes.md` 的中文翻译，同步至引擎版本 v0.1.0（源文档 commit 3133fb419ae3bc6e5c08bbbcd43ac7fa0289e44f）。
> 内容以英文源为准；发现不一致请更新英文源再同步翻译。

> - **Audience**: game authors
> - **Type**: how-to
> - **Status**: active
> - **Last verified**: v0.1.0

[语法参考](../reference/dsl/scene.md)是每个语法构造的权威——本页是任务视角：编写时随手查阅的配方，外加把它们接到地图上的 runner 契约。如果还没有接好地图与其场景，先从[你的第一个游戏](../tutorials/your-first-game.md)开始。

## 场景文件放在哪里

一个[场景](../reference/glossary.md)是一个 `.scene` 文件里的一个
`game_scene <Name> { ... }` 文档。没有 import 语句；每个文件独立编译。两个位置，一条规则：

- `assets/scenes/` —— 清单的 `game.scenesDir`（默认值），放剧情场景。
  `game.entryScene` 指定项目无地图运行时使用的文件。
- `<mapsDir>/<map>/script.scene` —— 逐地图场景。runner 以这个精确路径解析地图的场景，所以位置本身就是绑定。有地图时 `entryMap` 优先，由地图自己的场景驱动游玩。

两处编译方式相同。一个 `game_scene` 包含 `@variables`、`@storylines`
（未命名的 `main`）、具名 `@storyline("name")` 块，以及至多一个
`@load`（场景加载时运行）；完整块清单见[语法参考](../reference/dsl/scene.md)。

## NPC 对话

objects 伴生文件为 NPC 指定其运行的[剧情线](../reference/glossary.md)：npc 的 `talk` 字段是剧情线名，场景用[触发器](../reference/glossary.md)路由声明这条剧情线：

```json
"npcs": [{ "id": 1, "name": "Guide", "x": 10, "y": 7,
           "facing": "down", "sprite": "guide", "talk": "guide_talk" }]
```

```dsl
game_scene Hometown {
    @storyline("guide_talk") {
        @trigger(map = "Hometown", npc = "Guide")
        @speaker("Guide") {
            "Welcome to Hometown!"
            "The warp east leads to the Clearing."
        }
    }
}
```

- `@speaker(name)` 标记由玩家发起的对话；各行合并为一个分页文本框，带 `"Name: "` 前缀。`@speaker("")` 是[旁白](../reference/glossary.md)形式——文本原样渲染，无前缀。
- 运行时匹配的是 npc 的 `talk` 字段；`@trigger` 的 `npc` 值是生成绑定里的路由键，两个名字要保持一致。
- 一个 NPC 一条剧情线是常规形态；完整的 trigger 键表见[语法参考](../reference/dsl/scene.md)。

## 进图过场

给 trigger 加 `on_enter = true`，地图加载时 runner 就会触发该剧情线；脚本化台词用 [`@say`](../reference/glossary.md)：

```dsl
game_scene Hometown {
    @storyline("hometown_intro") {
        @trigger(map = "Hometown", on_enter = true)
        @say("Guide") { "Hey! A traveler!" }
        @say("") { "The Guide walks over to greet you." }
    }
}
```

`@say` 与 `@speaker` 编译出同一个文本框——区别在含义：`@say` 是自动触发剧情线里的[过场对白](../reference/glossary.md)。地图的所有 `on_enter` 剧情线在地图加载时依次运行。

## 选项、flag 与分支

菜单是 `@choice` 加 `@option` 块体；用 `@if` / `@else` 对表达式分支。[flag](../reference/glossary.md) 在同一会话内跨场景保留，并随存档保存：

```dsl
game_scene Hometown {
    @storyline("guide_talk") {
        @trigger(map = "Hometown", npc = "Guide")
        @if (getFlag("WON_GUIDE_BATTLE")) {
            @speaker("Guide") { "You beat the slime!" }
        } @else {
            @speaker("Guide") { "Want to try a battle?" }
            @choice {
                @option("Let's fight!") {
                    result = startBattle("slime")
                    @if (result == "win") {
                        @speaker("Guide") { "Well fought!" }
                        setFlag("WON_GUIDE_BATTLE")
                    } @else {
                        @speaker("Guide") { "Heal up and try again." }
                    }
                }
                @option("Not yet.") {
                    @speaker("Guide") { "Come back anytime." }
                }
            }
        }
    }
}
```

- 最后一个 `@option` 是菜单的回退分支。
- 条件可以调用 `getFlag("X")` 这类同步查询；异步命令不要放进条件。
- `result = startBattle("id")` 绑定战斗结果——`"win"`、`"lose"` 或 `"run"`——场景据此分支。普通赋值提升到剧情线顶部；调用赋值的留在原位。

## 场景内战斗

`startBattle(id)` 从剧情线发起一场战斗：id 先解析为 [encounter](../reference/glossary.md) 记录（含 trainer 战斗），再解析为单个敌人记录——即[野怪战斗](../reference/glossary.md)，逃跑必定成功。走路触发的随机战斗则不同：它们是 [sceneless 战斗](../reference/glossary.md)，由地图的 `encounters` 块武装，永不恢复场景——见[制作地图](./maps.md)与[战斗规则](../reference/battle-rules.md)。

## 双语文本

用 [`@t("en", "中文")`](../reference/glossary.md) 编写对白，宿主在运行时按清单的 `story.locales` 选择变体，回退到 `en`：

```dsl
game_scene Hometown {
    @storyline("guide_talk") {
        @trigger(map = "Hometown", npc = "Guide")
        @speaker("Guide") {
            @t("Welcome to Hometown!", "欢迎来到家乡镇！")
        }
    }
}
```

配方与运行时规则见[i18n 指南](./i18n.md)。

## 编写-检查循环

1. 编写或修改 `.scene` 文件。
2. 运行 `dotzuki check` —— 它编译所有场景（以及布局、主题、样式）并输出诊断；退出码 0 表示场景全部通过编译。
3. 运行 `dotzuki run` 走一遍剧情线；走路走不到的分支（胜负路径）用临时 flag 或 trigger 验证最方便。

同一 (map, npc) 路由没有 `after` 链会在编译期告警为冲突；措辞与完整 trigger 表见[语法参考](../reference/dsl/scene.md)。
