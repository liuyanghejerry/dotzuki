# 素材

如何管理游戏素材：tileset 与共享瓦片库、转换 Game Boy 2bpp 美术、字体，以及每个文件的存放位置。

> 本文是 `how-to/assets.md` 的中文翻译，同步至引擎版本 v0.1.0（源文档 commit 3133fb419ae3bc6e5c08bbbcd43ac7fa0289e44f）。
> 内容以英文源为准；发现不一致请更新英文源再同步翻译。

> - **Audience**: game authors
> - **Type**: how-to
> - **Status**: active
> - **Last verified**: v0.1.0

本页是素材管线视角；tileset 的地图侧是[制作地图](./maps.md)，素材目录的清单契约是[项目清单](../reference/project-manifest.md)，编辑器导览是[在编辑器中制作你的第一个游戏](../tutorials/editor-first-game.md)。

## 素材放在哪里

清单的 `assets` 活动声明素材目录——`config.roots`（相对项目根的路径）加可选的 `extensions`——编辑器的 Assets 活动列出的正是这些根目录。按惯例 `gfx/` 是散件素材根目录（tileset、精灵）：

```json
{ "id": "assets", "type": "assets",
  "config": { "roots": ["gfx"], "extensions": [".png", ".json"] } }
```

脚手架项目自带一套可用的布局：`assets/tileset.png`（32×8 演示图）、`assets/scenes/`，以及 `data/tiles/`——支撑地图编辑器选瓦片面板（Backdrop/Trace）的共享瓦片库。声明根目录之外的一切都是项目数据，不是受管素材。

## Tileset

tileset 是 `tileset.png` 图集加它的 Tiled 元数据：全彩 RGBA、8×8 像素瓦片横向排列、[GID](../reference/glossary.md) 从 1 起、行优先。地图的 `map.tmx.json` 引用自己 `tileset.png` 里的 GID；collision 层用非零 GID 标记阻挡瓦片——完整地图契约见[制作地图](./maps.md)。

`.tsx` 文件为 Tiled 命名同一张图，让地图编辑器能把瓦片当调色板用。逐地图的 `tileset.png` 与 `script.scene` 一起生成；可复用的图放在共享的 `data/tiles/` 库里。

## 转换 Game Boy 2bpp 美术

[`tools/asset-converter/`](../../tools/asset-converter/README.md) 把 GB 风格的 2bpp tileset（4 色阶灰度 PNG）转成你指定[调色板](../reference/glossary.md)下的全彩 RGBA tileset，并顺带写出 `.tsx`。输入灰度到 2bpp 索引的映射：

| 灰度值 | 调色板索引 | 含义 |
|---|---|---|
| 0–63 | 3 | 黑（最深） |
| 64–127 | 2 | 深灰 |
| 128–191 | 1 | 浅灰 |
| 192–255 | 0 | 白（最浅） |

调色板是按索引顺序排列的四色 RGBA JSON 文件：

```json
{
  "name": "my-palette",
  "colors": [
    { "r": 255, "g": 255, "b": 255 },
    { "r": 200, "g": 200, "b": 200 },
    { "r": 96,  "g": 96,  "b": 96 },
    { "r": 0,   "g": 0,   "b": 0 }
  ]
}
```

转换单张图，或整目录的 PNG：

```sh
cargo run -- -i tileset_2bpp.png -p custom_palette.json -o tileset_rgba.png

cargo run -- --all --input-dir gfx/tilesets --output-dir assets/converted \
  --batch-palette custom_palette.json
```

转换器是引擎仓库里的 Rust 工具；在 `tools/asset-converter/` 目录下运行。它产出地图契约所需的 `tileset.png` + `.tsx` 组合——即"扒下来的 GB 美术"到"可用的 dotzuki tileset"之间的那一步。

## 字体

游戏文本不需要字体文件：渲染器内置 10px 等宽位图字体（Fusion Pixel，OFL-1.1），覆盖 CJK，双语文本开箱即渲染——文本侧见[i18n 指南](./i18n.md)。Rust 游戏可以通过渲染器的资源提供者替换自己的字体 tileset；crate 地图见 [Rust API](../reference/rustdoc.md)。

## 编辑器工作流

编辑器的 Assets 活动展示清单的素材根目录；Tiles 活动把共享的 `data/tiles/` 库提供给地图编辑器。在编辑器里创作，把图放在已声明的根目录下，换素材后重新检查项目——`dotzuki check` 编译 DSL 侧，[`dotzuki run`](../reference/cli.md) 在播放器里给出结果。
