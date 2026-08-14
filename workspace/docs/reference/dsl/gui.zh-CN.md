# GUI DSL 参考

> 本文是 `reference/dsl/gui.md` 的中文翻译，同步至引擎版本 v0.1.0（源文档 commit 3133fb419ae3bc6e5c08bbbcd43ac7fa0289e44f）。
> 内容以英文源为准；发现不一致请更新英文源再同步翻译。

`.gui` 布局文件与 `ui {}` 块的权威语法参考：每个已实现的组件、属性与绑定，以及它们
编译成的 schema v2 JSON。

> - **Audience**: game authors
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.1.0

旧版 GAME_UI_DSL 文档中的提案保存在 archive/game-ui-dsl.md；本页只记录已实现的表面。

## 概览

GUI DSL 是描述游戏界面的声明式 UI 语言。编译器支持两种使用方式：

1. **独立的 `.gui` 文件**——纯 UI 布局定义，编译为 schema v2 JSON
2. **`.scene` 文件里的 `ui` 块**——与游戏脚本共存的内联 UI 布局

### 已实现的核心特性

- **声明式语法**——描述"是什么"而非"怎么做"
- **Tile 坐标定位**——在 20×18 tile 网格上绝对定位（通过 `rect`）
- **内置组件类型**——`panel`、`container`、`text`、`button`、`tile`、`divider`、
  `list`、`flex_list`、`cursor`、`bracket`、`pixel_rect`
- **自定义组件**——`component` 声明（构建期 prop schema）加游戏注册的 `custom:*` 元素
  （见自定义组件一节）
- **对象字面量**——`{key: value, ...}` 语法用于复杂属性
- **模板变量**——`{variable}` 运行时数据绑定
- **双语文本（i18n）**——`@t("en", "中文")` 内联本地化字符串（见双语文本一节）
- **Schema v2 输出**——编译为渲染器期望的 JSON 格式

### 双语文本（i18n）—— `@t`

任何 `text(...)` 或 `button(...)` 的文本实参都可以用 `@t("english", "中文")` 包裹以
支持双语（第一个实参是英文 `en`，第二个是中文 `zh`）：

```
text(@t("TEXT SPEED", "文字速度")) { rect = {tx: 1, ty: 1, tw: 16, th: 1} }
button(@t("CANCEL", "取消"))      { rect = {tx: 2, ty: 16, tw: 8, th: 1} }
```

编译为 schema v2 JSON 时，`value` 字段变为按语言索引的对象：

```json
{ "type": "text", "value": { "en": "TEXT SPEED", "zh": "文字速度" } }
```

渲染器按当前语言（`DataContext` 的 `__lang`，默认 `en`）挑选文本；缺失的语言回退到
`en`，再回退到任意现成的语言。普通字符串（不用 `@t`）行为不变，编译为单个字符串。
`@t` 也能与模板绑定混用：`@t("MONEY ${balance}", "金钱 ${balance}")`。

> 在 `.scene` 脚本 DSL 中，`@t(...)` 同样适用于 `@speaker` 文本与 `@option` 标签，编译
> 为运行时的 `game.t("en", "zh")` 调用（见 [how-to/i18n.md](../../how-to/i18n.md)）。

## 语法规则

### 文档结构

一个 `.gui` 文件包含一个 `screen` 声明：

```
screen Name {
    components
}
```

文件也可以在 `screen` 之前声明 `component`——或者只包含 `component` 声明（如
`components.gui` 这样的共享前奏）。在 `screen` 块内，每个条目都是一个组件，带可选 id：

```
[id =] type[(argument)] { properties and child components }
```

`screen` 与 `ui` 块只接受组件。场景级指令（`@variables`、`@theme`、`@style`、`@atlas`、
`@if`、`@each`）属于 `.scene` 脚本 DSL，不属于 `.gui` 文件；这些编译约定见
[codegen.md](codegen.md)。

### 缩进

- 用**空格**缩进（推荐 2 或 4 个）；词法器拒绝 tab。
- 同一层的语句必须使用相同的缩进。
- `{` 之后的内容缩进一层；`}` 减少一层。

### 注释

```
// 单行注释

/*
 * 多行注释
 * 可以跨行
 */
```

## 数据类型

### 基本类型

| 类型 | 示例 | 说明 |
| ---- | -------- | ----- |
| String | `"hello"`、`'world'` | 双引号或单引号 |
| Number | `42`、`3.14`、`-10` | 整数或小数 |
| Number (hex) | `0xFF` | 十六进制整数形式 |
| Boolean | `true`、`false` | 小写 |

### 复合类型

```
// Array
colors = ["red", "green", "blue"]
margins = [10, 20, 10, 20]

// Object
style = {
    color: "red"
    size: 14
}

// Multi-line object (recommended)
item = {
    name: "Sword"
    price: 120
    tags: ["weapon", "melee"]
}
```

对象字面量的字段使用 `key: value`。

### 模板变量（数据绑定）

```
// Binding
text = "{username}"
text = "你好，{username}！"
```

包含 `{...}` 的字符串原样通过编译器；渲染器在绘制时按运行时数据上下文解析它们。

## Tile 坐标系统

### 坐标系统

游戏屏幕使用 **20×18 tile 网格**：

- `tx`——tile 列（0 = 最左）
- `ty`——tile 行（0 = 最上）
- `tw`——宽度（单位 tile）
- `th`——高度（单位 tile）

### `rect` 属性

每个组件都接受用于绝对定位的 `rect` 属性：

```
panel {
    rect = {tx: 0, ty: 12, tw: 20, th: 6}
}

text("Hello") {
    rect = {tx: 1, ty: 13, tw: 18, th: 4}
}
```

### `rect` 中的模板变量

`rect` 的值可以是模板变量：

```
tile(223) {
    rect = {tx: "{cursor_x}", ty: 3, tw: 1, th: 1}
}
```

## 组件

### Panel —— 带边框容器

```
panel {
    rect = {tx: 0, ty: 12, tw: 20, th: 6}
    style = "default"              // "default" | "single" | "double" | custom object
    text("内容") { rect = {tx: 1, ty: 13, tw: 18, th: 4} }
}
```

**`style` 取值：**

- `"default"`——默认边框样式
- `"single"` / `"double"`——单线 / 双线边框
- 自定义对象：
  ```
  style = {corner_tl: 99, edge_top: 100, corner_tr: 101, edge_left: 102, edge_right: 103, corner_bl: 108, edge_bottom: 111, corner_br: 110}
  ```

### Container —— 无边框容器

```
container {
    rect = {tx: 0, ty: 0, tw: 20, th: 18}
    layout = {gap: 0}
    clip = false
    visible = "{show_entry1}"
    text("子元素") { rect = {tx: 4, ty: 0, tw: 10, th: 1} }
}
```

### Text —— 文本组件

```
text("显示内容") {
    rect = {tx: 1, ty: 1, tw: 6, th: 1}
    color = "Black"                // "Black" | "DarkGray" | "LightGray" | "White" | "#rrggbb"
    align = "left"                 // "left" | "center" | "right"
    font = "pk_glyph"              // font name
    wrap = "word"                  // "word" enables wrapping
    line_spacing = 1               // line spacing in tiles
}
```

**模板变量：**

```
text("{player_name}") {
    rect = {tx: 5, ty: 2, tw: 7, th: 1}
}
```

**`value` 别名：**

```
// Both forms are equivalent
text("Hello") { rect = {...} }
text {
    value = "Hello"
    rect = {...}
}
```

### Tile —— tile 渲染

```
tile(31) {
    rect = {tx: 18, ty: 16, tw: 1, th: 1}
}

tile("{sprite_index}") {
    rect = {tx: 15, ty: 4, tw: 2, th: 2}
    visible = "{has_selected}"
    flip_x = false
    flip_y = false
    palette = "name"
    repeat = 1                     // horizontal repeat count
}
```

### Divider —— 分隔线

```
divider {
    rect = {tx: 1, ty: 9, tw: 18, th: 1}
    tiles = [122]                  // array of tile ids
    repeat = 17                    // repeat count
    orientation = "horizontal"     // "horizontal" | "vertical"
}
```

### List —— 滚动列表

```
list {
    rect = {tx: 1, ty: 1, tw: 11, th: 3}
    source = "{items}"             // data-source template variable
    item_template = {height: 1, gap: 1}
    cursor = {tile: 223, position: "left"}
    max_visible = 3
    selected = 0
    footer = "text"
}
```

**`cursor` 属性：**

- 简写：`cursor = {tile: 223}`（只有 tile id）
- 完整形式：`cursor = {tile: 223, position: "left"}`

### FlexList —— 多列列表

```
flex_list("{bag_items}") {
    rect = {tx: 1, ty: 4, tw: 18, th: 13}
    item_layout = [
        {field: "name", width: 14, align: "left"},
        {field: "qty", width: 3, align: "right", prefix: "x"}
    ]
    padding = {top: 1, left: 1}
    gap = 1
    cursor = {tile: 223, position: "left"}
    selected = 0
}
```

**`item_layout` 列定义：**

- `field`——数据字段名
- `width`——列宽（单位 tile）
- `align`——对齐方式
- `prefix`——值前缀（如 `"x"`、`"$"`）

### Button —— 按钮

```
button("确定") {
    rect = {tx: 10, ty: 15, tw: 5, th: 1}
    on_click = "handler"
}
```

### Image —— 图片

```
image("sprite.png") {
    rect = {tx: 0, ty: 0, tw: 7, th: 7}
    slice = "[8,8,8,8]"            // nine-slice margins
}
```

### Input / Dropdown —— 输入组件

```
input {
    rect = {tx: 0, ty: 0, tw: 20, th: 1}
    placeholder = "请输入..."
}

dropdown {
    rect = {tx: 0, ty: 0, tw: 10, th: 1}
}
```

`input` 编译为 `custom:input` 元素，`dropdown` 编译为 `custom:dropdown` 元素；渲染器
由游戏注册。

### Cursor —— 选择光标

从 `rect.tx/ty` 基点出发，以"基点 + 网格偏移"的步进绘制选择标记（▶）。最终位置为
`base_tx + col*col_step` / `base_ty + row*row_step`，其中 `col`/`row` 是数据绑定：

```
cursor {
    rect = {tx: 5, ty: 14, tw: 1, th: 1}
    row = "{cursor}"          // 1-D list cursor: set row_step only
    row_step = 2
}
```

- 1-D 列表光标：设置 `row_step`、`row = "{cursor}"`
- 2-D 网格（战斗 FIGHT/MON/ITEM/RUN）：同时设置 `col_step` + `row_step`
- 枚举偏移选择器（设置界面）：`col_step = 1`、`col = "{opt_index}"`
- 多光标界面（队伍界面的 ▶ + ◆）：放置多个 `cursor` 元素，各自带自己的 `visible` 条件

### Bracket / PixelRect —— 像素图元

pokered-ui `Frame` 图元（bracket 边框、纯矩形）的声明式版本，基于 painter 的
`draw_pixel_rect` 合成：

```
bracket {
    rect = {tx: 0, ty: 8, tw: 10, th: 4}
}

pixel_rect {
    rect = {tx: 2, ty: 2, tw: 4, th: 1}
}
```

### 自定义组件 —— `component` 声明 + `custom:*` 元素

引擎核心不包含游戏特有的图元（例如 Gen-I HP 条）。游戏把它们注册为 `custom:*` 元素
（`ElementRegistry`；pokered 使用 pokered-ui 的 `custom_elements` 模块），`.gui` 用
`component` 声明它们的构建期 schema。编译器对照声明校验每个使用位置（缺少 required
prop、prop 类型不符、未声明的 prop 都是编译错误）；运行时加载布局后，实现侧的
`schema()` 会再次校验。

声明（通常收集在共享的 `components.gui` 中）：

```
// Gen-I HP bar: 4px tall, three-color fill by the original GetHealthBarColor thresholds
component hp_bar {
  current: expr required
  max: expr required
}
```

prop 类型为 `int` / `string` / `bool` / `color` / `expr`，可带可选的 `required` 标记。
使用位置把声明的名字写为元素类型：

```
hp_bar {
    rect = {tx: 13, ty: 3, tw: 6, th: 1}
    current = "{hp}"
    max = "{max_hp}"
}
```

编译出的 JSON 元素 `type` 为 `custom:hp_bar`；由游戏注册的实现负责渲染。

## 完整示例

### 对话框

```
screen Dialog {
    panel {
        rect = {tx: 0, ty: 12, tw: 20, th: 6}
        style = "default"
        text("{text}") {
            rect = {tx: 1, ty: 13, tw: 18, th: 4}
            wrap = "word"
            line_spacing = 1
        }
        tile(31) {
            rect = {tx: 18, ty: 16, tw: 1, th: 1}
        }
    }
}
```

编译输出：

```json
{
    "schema_version": 2,
    "screen": "Dialog",
    "elements": [
        {"type": "border", "rect": {"tx": 0, "ty": 12, "tw": 20, "th": 6}, "style": "default", "children": [
            {"type": "text", "rect": {"tx": 1, "ty": 13, "tw": 18, "th": 4}, "value": "{text}", "wrap": "word", "line_spacing": 1},
            {"type": "tile", "rect": {"tx": 18, "ty": 16, "tw": 1, "th": 1}, "tile_id": 31}
        ]}
    ]
}
```

### 背包界面

```
screen Bag {
    panel {
        rect = {tx: 6, ty: 0, tw: 8, th: 3}
        style = "default"
    }
    text("ITEM") {
        rect = {tx: 7, ty: 1, tw: 6, th: 1}
    }
    panel {
        rect = {tx: 0, ty: 3, tw: 20, th: 15}
        style = "default"
    }
    flex_list("{bag_items}") {
        rect = {tx: 1, ty: 4, tw: 18, th: 13}
        item_layout = [
            {field: "name", width: 14, align: "left"},
            {field: "qty", width: 3, align: "right", prefix: "x"}
        ]
        padding = {top: 1, left: 1}
        gap = 1
        cursor = {tile: 223, position: "left"}
    }
    text("CANCEL") {
        rect = {tx: 2, ty: 16, tw: 16, th: 1}
        color = "DarkGray"
    }
}
```

### 队伍界面

```
screen Party {
    text("No MONSTER!") {
        rect = {tx: 3, ty: 8, tw: 10, th: 1}
        visible = "{show_empty}"
    }
    container {
        rect = {tx: 0, ty: 0, tw: 20, th: 18}
        layout = {gap: 0}
        clip = false
        visible = "{show_entry1}"
        text("{mon1_name}") {
            rect = {tx: 4, ty: 0, tw: 10, th: 1}
        }
        text("L{mon1_level}") {
            rect = {tx: 14, ty: 0, tw: 3, th: 1}
        }
        text("{mon1_status}") {
            rect = {tx: 17, ty: 0, tw: 3, th: 1}
            color = "DarkGray"
        }
        text("{mon1_hp}") {
            rect = {tx: 14, ty: 1, tw: 6, th: 1}
        }
    }
    // ... mon2 through mon6 share this structure
}
```

## 语法一览

已实现的语法（pokered UI 布局）：

| 类别 | 语法 | 示例 |
| -------- | ------ | ------- |
| **界面** | `screen` | `screen Dialog { }` |
| **组件** | `type`、`id = type` | `text("hello")`、`tile(31)` |
| **定位** | `rect` | `rect = {tx: 0, ty: 12, tw: 20, th: 6}` |
| **属性** | `key = value` | `align = "center"` |
| **绑定** | `{expression}` | `"{player_name}"` |
| **对象字面量** | `{key: value}` | `cursor = {tile: 223, position: "left"}` |
| **边框** | `panel` | `panel { style = "default" }` |
| **容器** | `container` | `container { layout = {gap: 0} }` |
| **文本** | `text` | `text("Hello") { color = "Black" }` |
| **Tile** | `tile` | `tile(31) { rect = {...} }` |
| **分隔线** | `divider` | `divider { tiles = [122] repeat = 17 }` |
| **列表** | `list` | `list { source = "{items}" }` |
| **多列列表** | `flex_list` | `flex_list("{items}") { item_layout = [...] }` |
| **按钮** | `button` | `button("OK") { on_click = "handler" }` |
| **图片** | `image` | `image("sprite.png") { slice = "..." }` |
| **输入框** | `input` | `input { placeholder = "..." }` |
| **下拉框** | `dropdown` | `dropdown { }` |
| **光标** | `cursor` | `cursor { row = "{cursor}" row_step = 2 }` |
| **Bracket 边框** | `bracket` | `bracket { rect = {...} }` |
| **像素矩形** | `pixel_rect` | `pixel_rect { rect = {...} }` |
| **自定义组件** | `component` 声明 + 使用 | `component hp_bar { current: expr required }` → `hp_bar { current = "{hp}" }` |

`on_click` 是唯一已实现的事件属性（位于 `button` 上）；其他 `on_*` 事件属性、`t()`
运行时翻译函数、`dir`/RTL 与动画仍然是提案。

## 设计原则

已实现的表面遵循以下原则：

1. **声明式**——描述"是什么"而非"怎么做"
2. **Tile 坐标**——在 20×18 网格上绝对定位
3. **组件化**——内置组件加通过 `component` 声明定义的游戏自定义组件（`custom:*`）
4. **数据绑定**——`{var}` 模板变量在运行时解析
5. **对象字面量**——`{key: value}` 语法用于复杂属性
6. **Schema v2 输出**——编译为渲染器期望的 JSON 格式
7. **构建期校验**——使用位置在编译期对照 `component` schema 检查，运行时加载后再次
   校验

## 文件扩展名与编译输出

| 文件类型 | 扩展名 | 用途 | 状态 |
| --------- | --------- | ------- | ------ |
| 场景文件 | `.scene` | 游戏场景（脚本 + 可选 UI） | 已实现 |
| UI 布局 | `.gui` | 纯 UI 布局定义 | 已实现 |
| 主题文件 | `.theme` | 颜色主题定义 | 已实现 |
| 样式文件 | `.style` | 可复用样式集合 | 已实现 |
| 资源清单 | `.res` | 资源清单 | 未实现 |
| 动画定义 | `.anim` | 关键帧动画定义 | 未实现 |

| 输入 | 输出 | 用途 |
| ----- | ------ | ------- |
| `.scene` | `name.js` + `name_ui.json` | 脚本 + 可选 UI 布局 |
| `.gui` | `name.json`（schema v2） | 纯 UI 布局 |
| `.theme` | `name.json` | 主题 token |
| `.style` | `name_styles.json` | 解析后的样式（含继承链） |

同时携带 `@theme`、`@style` 或 `@atlas` 块的 `.scene` 会额外产出 `name_theme_N.json`、
`name_styles.json` 与 `name_atlas_N.json` 产物。`.theme` 与 `.style` 文件语法见
[theme-style.md](theme-style.md)。

## 相关页面

- [Scene DSL 编译约定](codegen.md)——场景层的 `@variables`、`@theme`、`@style`、
  `@atlas` 与 `@if`/`@each`
- [主题与样式文件参考](theme-style.md)——`.theme` / `.style` 语法
- [项目清单](../project-manifest.md)——DSL 文件在游戏项目中的位置
- [国际化指南](../../how-to/i18n.md)
- [设计历史](../../archive/dsl-unified-design.md)
- [文档索引](../../index.md)
