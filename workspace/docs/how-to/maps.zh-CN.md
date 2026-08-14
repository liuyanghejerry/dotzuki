# 地图

> 本文是 `how-to/maps.md` 的中文翻译，同步至引擎版本 v0.1.0（源文档 commit 3133fb419ae3bc6e5c08bbbcd43ac7fa0289e44f）。
> 内容以英文源为准；发现不一致请更新英文源再同步翻译。

如何定义地图：Tiled JSON、tileset、`objects.json` 伴生文件、海拔与 encounters。

> - **Audience**: game authors
> - **Type**: how-to
> - **Status**: active
> - **Last verified**: v0.1.0

开始前，请先阅读[项目清单](../reference/project-manifest.md)——它定义了地图目录以及
这些文件所接入的运行器契约。

## 地图文件

一张地图由 `<mapsDir>/<id>/map.tmx.json`（Tiled JSON；名为 `collision` 的图层标记阻
挡 tiles，其余图层参与渲染）加上 `tileset.png`（全彩色 atlas，GID 从 1 开始、按行主
序排列），再加上一个可选的 objects 伴生文件——`objects.json`（由编辑器写入）组成，其
中包含 `npcs: [{id,name,x,y,facing,sprite,talk}]`、`warps: [{x,y,dest_map,dest_x,dest_y}]`、
`signs: [{x,y,text}]`（面向告示牌 tile 并按 A，以分页对话的形式读出其文本），以及一
个可选的 `encounters` 块（见下文）（旧版 `map.json` 作为后备读取）。走上 warp tile
（传送点）会淡出切换到目标地图。

## 海拔层级

地图可以是多层的（既能在地面行走，*也能*在墙顶行走）。每层的碰撞：名为 `collision`
（第 0 层）、`collision1`、`collision2`、…… 的图层——该层中非零 GID 即为实心；这些图
层从不渲染。缺失的中间层视作全部实心。名为 `stairs` 的图层标记过渡 tiles（从不渲
染）：抵达时 GID 1 上升一层，GID 2 下降一层（限制在地图的层数范围内）。视觉图层可携
带一个可选的整数自定义属性 `level`（默认 0）：`level <= player elevation` 的图层渲染
在精灵下方，`level` 高于玩家海拔的图层渲染在精灵上方。只有 `collision` 图层的地图与
单层地图表现完全一致。

## 随机 encounters

地图通过在 objects 伴生文件中加入 `encounters` 块来开启野怪战斗——与 pokered 的
`wild_data` 结构相同：一个按步触发的 `rate` 字节，以 **/256** 为单位（`25` ≈ 每步
9.8%），加上若干 tile 矩形区域，每个区域各有一张加权表：

```json
"encounters": {
  "rate": 25,
  "zones": [
    { "x": 0, "y": 5, "w": 8, "h": 3,
      "table": [ { "id": "slime", "weight": 70 }, { "id": "bug-catcher", "weight": 30 } ] }
  ]
}
```

区域坐标以地图 tiles 为单位，矩形**包含**其 `w`×`h` 的范围。在区域内 tile 上完成一步
行走后掷骰一次：一个 rng 字节 `< rate` 即命中，随后从该区域的 `table` 做一次加权抽取
选出 id（`weight` 是相对值，默认 1）。id 的解析与 `startBattle(id)` 完全一致——先解析
encounter 记录（包括 trainer 队伍/队列），再解析单个敌人记录——并触发一场
**sceneless** 战斗（见[战斗规则](../reference/battle-rules.md)）。步进结算优先级为：
**warp > encounter 掷骰 > 普通行走**——走上 warp tile 从不掷骰，原地转身不算一步。
`encounters` 缺失（或为 `null`）⇒ 地图从不掷骰——旧的伴生文件保持原样继续工作。

encounter 记录的 schema 见 [Encounter 记录](../reference/data-tables/encounters.md)；
sceneless 战斗的结算见[战斗规则](../reference/battle-rules.md)。
