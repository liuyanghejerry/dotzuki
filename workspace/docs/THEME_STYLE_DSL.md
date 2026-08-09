# Theme & Style DSL 参考（`.theme` / `.style`）

主题与样式用独立的 `.theme` / `.style` 文件（或在 `.scene` / `.gui` 内联
`@theme` / `@style` 块）声明，由 `dotzuki-engine-dsl` 编译为 JSON 供渲染层
消费。本参考以当前 codegen（`crates/dotzuki-engine-dsl/src/codegen/json_theme.rs`）
为准；编译契约的 DSL 侧描述见 `DSL_MAPPING.md`（Entry 9/10）。

## 文件类型与编译输出

| 输入 | 内容要求 | 编译输出 |
|---|---|---|
| `foo.theme` | 至少一个 `@theme` 块 | 每个 `@theme <name>` → `<name>.json`（`{"name", "tokens"}`） |
| `bar.style` | 至少一个 `@style` 块 | `<scene名>_styles.json`（已解析继承的样式数组） |
| `.scene` 内联 `@theme` | — | `<scene名>_theme_<i>.json` |
| `.scene` 内联 `@style` | — | `<scene名>_styles.json` |

所有输出都是 `// @generated` 头 + JSON，由 `dotzuki check` 在编译期生成。

## `@theme` — 颜色主题

```dsl
@theme dark {
    primary    = "#c9a03d"
    background = "#1a1a2e"
    surface    = "#16213e"
    text       = "#eeeeee"
    text_muted = "#888888"
}
```

- `@theme <name> { <key> = <value>; ... }`，token 值为字符串 / 数字表达式。
- 编译为 `{"name": "dark", "tokens": {"primary": "#c9a03d", ...}}`。
- 在属性中按名引用主题 token：`background = "@theme.surface"`。

## `@style` — 样式复用（含继承链）

```dsl
@style card {
    border     = "rounded"
    padding    = 12
    background = "@theme.surface"
}

@style card_hover : card {
    background = "@theme.primary"
    scale      = 1.02
}
```

- `@style <name> { <prop> = <value>; ... }`。
- 继承用冒号：`@style <child> : <parent> { ... }`（不是 `extends` 关键字）。
- 编译期**解析继承链**：子属性覆盖父属性，输出

```json
[
  { "name": "card", "properties": { ... } },
  {
    "name": "card_hover",
    "extends": "card",
    "inheritance_chain": ["card_hover", "card"],
    "properties": { "border": "rounded", "padding": 12, "background": "@theme.primary", "scale": 1.02 }
  }
]
```

- 循环继承（`A : B : A`）是编译期错误；解析器会检测并截断环。

> **与 DSL_MAPPING Entry 10 的差异：** DSL_MAPPING 展示的
> `{"card_hover": {"__extends": "card"}}` 形态是旧描述；当前 codegen 输出
> `extends` 字段 + `inheritance_chain` 数组（见上）。以本文件为准。

## 使用方式

1. **独立文件**：`data/` 或 DSL 目录下的 `*.theme` / `*.style`，`dotzuki
   check` 编译。
2. **内联**：`.scene` 顶层的 `@theme` / `@style` 块，随场景编译。
3. **GUI 引用**：`.gui` / `ui {}` 组件通过 `style = "<name>"` 应用样式；
   `.theme` token 在属性值里以 `@theme.<key>` 引用。

> 注：GAME_UI_DSL.md 旧版章节（§4.2/4.3）描述了更完整的主题/样式愿景语法；
> 其中「`.gui` 内内联 `@theme`/`@style` 块」仍为 proposal（见该文档 §1.2 与
> §十四 核对说明）。
