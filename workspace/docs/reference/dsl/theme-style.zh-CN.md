# Theme 与 Style DSL 参考（`.theme` / `.style`）

> 本文是 `reference/dsl/theme-style.md` 的中文翻译，同步至引擎版本 v0.1.0（源文档 commit 3133fb419ae3bc6e5c08bbbcd43ac7fa0289e44f）。
> 内容以英文源为准；发现不一致请更新英文源再同步翻译。

> - **Audience**: DSL authors
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.1.0

`@theme` / `@style` 块的语法与编译输出；用法示例见[主题与样式指南](../../how-to/themes.md)。

你可以在独立的 `.theme` / `.style` 文件中声明主题与样式，也可以作为 `.scene` 文件
顶层的内联 `@theme` / `@style` 块声明（`.gui` 文件只能按名字引用样式），
`dotzuki-engine-dsl` 会把它们编译为渲染器使用的 JSON。本参考与当前 codegen
（`crates/dotzuki-engine-dsl/src/codegen/json_theme.rs`）保持一致。

## `@theme` —— 颜色主题

```dsl
@theme dark {
    primary    = "#c9a03d"
    background = "#1a1a2e"
    surface    = "#16213e"
    text       = "#eeeeee"
    text_muted = "#888888"
}
```

- 语法：`@theme <name> { <key> = <value>; ... }`。token 值只接受字符串（数值表达式是
  `@style` 属性的特性）。
- 编译为 `{"name": "dark", "tokens": {"primary": "#c9a03d", ...}}`。
- 属性按名字引用主题 token：`background = "@theme.surface"`。引擎不解析这个引用——
  值以字面字符串进入 JSON，由消费方/渲染器按约定解释。

## `@style` —— 可复用样式（含继承链）

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

- 语法：`@style <name> { <prop> = <value>; ... }`。
- 继承使用冒号形式 `@style <child> : <parent> { ... }`（没有 `extends` 关键字）。
- 编译器解析继承链：子属性覆盖父属性。上面的 card 示例编译为：

```json
[
  { "name": "card", "properties": { "border": "rounded", "padding": 12, "background": "@theme.surface" } },
  {
    "name": "card_hover",
    "extends": "card",
    "inheritance_chain": ["card_hover", "card"],
    "properties": { "border": "rounded", "padding": 12, "background": "@theme.primary", "scale": 1.02 }
  }
]
```

- 循环继承（`A : B : A`）是编译期错误（`CircularStyleInheritance`），会导致编译失败。

## 与旧文档的差异

旧版 `DSL_MAPPING.md` 条目 9/10 描述了单 map 的主题形态与
`{"card_hover": {"__extends": "card"}}` 样式形态。两者都已过时：当前 codegen 为每个
主题输出一个 `{"name", "tokens"}` 文件，样式输出带 `extends` 字段与 `inheritance_chain`
数组，如上所示。本页与 [codegen 约定](./codegen.md) 是权威依据。

> 注意：旧版 GAME_UI_DSL 文档（§4.2/4.3）勾勒了更宏大的主题/样式愿景；其中 `.gui`
> 内联 `@theme` 的部分仍然是提案（见[归档的 GAME_UI_DSL 文档](../../archive/game-ui-dsl.md)）。
