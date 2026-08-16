# UI 布局

如何制作 `.gui` 布局：20×18 tile 网格、面板与文本、模板绑定、双语标签、自定义组件，以及预览-检查循环。

> 本文是 `how-to/ui.md` 的中文翻译，同步至引擎版本 v0.1.0（源文档 commit 3133fb419ae3bc6e5c08bbbcd43ac7fa0289e44f）。
> 内容以英文源为准；发现不一致请更新英文源再同步翻译。

> - **Audience**: game authors
> - **Type**: how-to
> - **Status**: active
> - **Last verified**: v0.1.0

[GUI DSL 参考](../reference/dsl/gui.md)是每个组件与属性的权威——本页是任务视角。布局与[主题](./themes.md)、[双语文本](./i18n.md)配套；文件位置的清单契约见[项目清单](../reference/project-manifest.md)。

## 布局文件放在哪里

一个 `.gui` 文件包含一个 [`screen`](../reference/glossary.md)——顶层布局——前面可以有任意多个 [`component`](../reference/glossary.md) 声明。布局文件放在清单的 `ui` 活动下：其 `config.guiRoot`（相对项目根）是布局目录，`dotzuki check` 编译其中的全部内容：

```json
{ "id": "ui", "type": "ui", "config": { "guiRoot": "ui", "extension": ".gui" } }
```

一个文件也可以只含 `component` 声明——共享前奏模式，按惯例是同目录下的 `components.gui`。此外，`.scene` 文件里的 `ui { }` 块声明内联布局；它与场景一起编译为 `<SceneName>_ui.json`（见[编写场景](./scenes.md)）。所有形式都编译为渲染器期望的同一种 schema-v2 JSON。

## tile 网格

所有定位都是绝对定位，画布是 20×18 的 tile 网格。每个组件都带一个 `rect`：

```
screen Box {
    panel {
        rect = {tx: 0, ty: 12, tw: 20, th: 6}
    }
}
```

- `tx` / `ty` —— 左上角的 tile 列 / 行（从 0 起）。
- `tw` / `th` —— 宽 / 高，单位为 tile。

宽 20、高 18：全宽底部面板是 `tx: 0, ty: 12, tw: 20, th: 6`，全屏容器是 `tx: 0, ty: 0, tw: 20, th: 18`。

## 对话框

经典屏幕底部文本框 = 带边框的 `panel` + `text` 子元素 + 闪烁的 `tile` 光标：

```
screen Dialog {
    panel {
        rect = {tx: 0, ty: 12, tw: 20, th: 6}
        style = "default"
        text("{text}") {
            rect = {tx: 1, ty: 13, tw: 18, th: 4}
            wrap = "word"
        }
        tile(31) {
            rect = {tx: 18, ty: 16, tw: 1, th: 1}
        }
    }
}
```

`style` 选择边框（`"default"`、`"single"`、`"double"`，或 tile id 的自定义对象）；`wrap = "word"` 让文本在 `rect` 内换行。编译出的 JSON 是纯数据——渲染器绘制的形状：

```json
{
    "schema_version": 2,
    "screen": "Dialog",
    "elements": [
        {"type": "border", "rect": {"tx": 0, "ty": 12, "tw": 20, "th": 6}, "style": "default", "children": [
            {"type": "text", "rect": {"tx": 1, "ty": 13, "tw": 18, "th": 4}, "value": "{text}", "wrap": "word"},
            {"type": "tile", "rect": {"tx": 18, "ty": 16, "tw": 1, "th": 1}, "tile_id": 31}
        ]}
    ]
}
```

## 模板变量

字符串里的 `{name}` 是[模板变量](../reference/glossary.md)——原样通过编译器，由渲染器在绘制时按运行时数据上下文解析。绑定可用于文本值、`rect` 值与条件：

```
screen BattleHud {
    text("{player_name}") {
        rect = {tx: 1, ty: 1, tw: 7, th: 1}
    }
    tile("{sprite_index}") {
        rect = {tx: 15, ty: 2, tw: 2, th: 2}
        visible = "{has_sprite}"
    }
    text("L{level}") {
        rect = {tx: 14, ty: 1, tw: 3, th: 1}
        color = "DarkGray"
    }
}
```

游戏（或编辑器预览）提供数据；布局负责命名。菜单同理：`list` 或 `flex_list` 接受 `source = "{items}"` 绑定，`cursor` 按 `row` / `col` 绑定移动——各列表形状见 [GUI DSL 参考](../reference/dsl/gui.md)。

## 双语标签

把任意 `text(...)` 或 `button(...)` 参数包进 `@t("en", "中文")`，标签就编译为按语言索引的对象；渲染器按当前语言挑选，回退到 `en`：

```
screen Options {
    text(@t("TEXT SPEED", "文字速度")) {
        rect = {tx: 1, ty: 1, tw: 16, th: 1}
    }
    button(@t("CANCEL", "取消")) {
        rect = {tx: 2, ty: 16, tw: 8, th: 1}
    }
}
```

`@t` 可与绑定混用——`@t("MONEY ${balance}", "金钱 ${balance}")`——语言列表由清单的 `story.locales` 声明。运行时规则见[i18n 指南](./i18n.md)。

## 自定义组件

内置组件覆盖面板、文本、tile、列表与光标。游戏专属的部件（血条、队伍卡片）在共享文件里声明、按名字使用；编译器对每个使用点做声明校验：

```
// components.gui — 仅属性 schema，所有布局共享
component hp_bar {
  current: expr required
  max: expr required
}
```

```
// battle.gui
screen BattleHud {
    hp_bar {
        rect = {tx: 13, ty: 3, tw: 6, th: 1}
        current = "{hp}"
        max = "{max_hp}"
    }
}
```

编译出的元素类型是 `custom:hp_bar`。缺少 required 属性、属性类型不符或属性未声明都是编译错误。渲染元素是游戏侧的工作：游戏向渲染器（`ElementRegistry`）注册自己的 `custom:*` 实现。zero-Rust runner 自带界面（对话、菜单、战斗）是引擎部件而非布局；自定义布局出现在注册了渲染器的游戏里——包括下面的编辑器预览。

## 预览-检查循环

1. **编辑** —— 在 dotzuki-editor 的 UI 活动中改布局。编辑器预览会编译源码、注入主题、绑定编辑器数据并光栅化，因此布局坏了会显示编译错误而不是画面。
2. **检查** —— 运行 `dotzuki check`：编译 `ui` 活动 `guiRoot` 下的每个布局（以及场景里的每个 `ui { }` 块）并输出诊断；退出码 0 表示布局全部通过编译。
3. **交付** —— 编译出的 schema-v2 JSON 是游戏侧契约；精确形状见 [codegen 契约](../reference/dsl/codegen.md)。
