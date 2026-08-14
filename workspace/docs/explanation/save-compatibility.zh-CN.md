# 存档兼容性

> 本文是 `explanation/save-compatibility.md` 的中文翻译，同步至引擎版本 v0.1.0（源文档 commit 3133fb419ae3bc6e5c08bbbcd43ac7fa0289e44f）。
> 内容以英文源为准；发现不一致请更新英文源再同步翻译。

存档版本机制、向前/向后兼容规则，以及每个工具都必须遵守的兼容性规则。

> - **Audience**: game authors, rust developers
> - **Type**: explanation
> - **Status**: active
> - **Last verified**: v0.1.0

游戏保存到 `<project>/.dotzuki-save.json`（可用 `--save-file` 覆盖）——带存档版本
的 JSON：`{version, map, player: {x, y, facing, level?}, flags, lang, party?,
inventory?, money?}`（v3）。运行器侧的存档/读取契约见
[Save/load](../reference/project-manifest.md#saveload)。

- 战斗完成后，`party`/`inventory` 才会出现。
- 当战斗带有 `levels` 块时，队伍成员可携带可选的 `level`/`exp` 字段——缺失 ⇒ 等级
  1 / 0 经验。
- `money` 总是被写入。
- `player.level` 是地图海拔层，缺失 ⇒ 0。

## 何时写入存档

存档只在**稳定**状态下写入——在完成一次传送点（warp）之后、以及场景结束回到大地图时
——从不在场景中途或传送中途写入（被挂起的场景引擎无法恢复），因此对话中途关闭窗
口会保留最后一个稳定点。Start 菜单的 **Save** 项按需写入同一文件（始终允许，无头
模式运行下也不例外）。

有窗口的运行总是写入存档；`--headless` 从不写入，除非传入 `--save`（CI 保持无副
作用）。

## 向后兼容：加载旧存档

加载接受任何 `<=` 当前版本的版本，并逐字段应用默认值——**v1/v2 存档仍可恢复**
（没有 `party`/`inventory` ⇒ 两者都从零开始；没有 `money` ⇒ 应用项目清单的
`shop.startMoney` 默认值）。每个成员的 `level` + `exp` 是 OPTIONAL 字段；缺失 ⇒
等级 1 / 0 经验，因此存档版本保持为 3，旧存档继续可加载。

启动时，有效存档直接恢复：flags 被还原，加载存档的地图，玩家被放置在存档的 tile
上（若该 tile 已被占用则回退到出生点扫描），队伍状态、背包与金钱一并恢复，开场派
发被跳过——还原的 `__played_main_*` flags 防止 `main` 在后续进入时重播。

## 向前兼容：更新或损坏的存档

缺失/损坏/**版本更新**的存档会给出警告并以全新状态启动。`--fresh` 忽略存档；
`--map` 覆盖存档中的地图。

## 项目兼容性规则

- **`.dotzuki-editor.json` 是唯一的项目清单。** 任何工具都不得要求游戏项目中还有
  第二个配置文件。
- **未知键会被容忍。** 读取方必须忽略它们不认识的键（顶层、每个活动内部以及
  `config` 内部的键）；重写项目清单的工具应当保留这些键。每张地图的
  `objects.json` 伴生文件同样如此：编辑器原样透传它不认识的键（例如手工编写的
  `encounters` 块）。
- **伴生文件的优先级是 `objects.json` 高于 `map.json`。** `dotzuki new` 与旧项目
  会生成 `map.json` 骨架，但一旦编辑器保存了地图的实体，它就会写入
  `objects.json`，此后 `objects.json` 遮蔽 `map.json`（运行器先读 `objects.json`，
  仅在缺失时才回退）。这是已知的现行行为，在此记录——不作改变。
- **`game` 段是可选的。** 编辑器完整支持没有它的项目；CLI 消费方应用
  [`game` 段默认值](../reference/project-manifest.md#the-game-section)。
- **往返保证。** `dotzuki new` 的产出在编辑器中打开后保持不变，编辑器向导创建的
  项目能通过 `dotzuki check`。两个脚手架生成器产出相同的目录布局、相同的七个活动
  （maps、scripts、play、data、story、assets、tiles）与相同的配置形态，以及结构
  相等的初始场景。有意的差异：`game` 段（只有 `dotzuki new` 会写它）与初始
  *内容*——编辑器的脚手架生成器会种下[目录布局](../reference/project-manifest.md#directory-layout)中描述的演示地图、tile 库、示例记录与叙事圣经（story bible），
  而 `dotzuki new` 产出最小骨架。
