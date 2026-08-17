# 主题与样式指南

> 本文是 `how-to/themes.md` 的中文翻译，同步至引擎版本 v0.1.0（源文档 commit 3133fb419ae3bc6e5c08bbbcd43ac7fa0289e44f）。
> 内容以英文源为准；发现不一致请更新英文源再同步翻译。

> - **Audience**: game authors
> - **Type**: how-to
> - **Status**: active
> - **Last verified**: v0.1.0

在 `.theme` / `.style` 文件（或内联的 `@theme` / `@style` 块）中声明颜色与可复用的样式
集，并把它们应用到 UI 组件上。语法与 codegen 约定见
[主题与样式参考](../reference/dsl/theme-style.md)。

主题与样式经 `dotzuki-engine-dsl` 编译成渲染器消费的 JSON。`dotzuki check` 在内存中校
验它们而不写任何产物；只有给出输出目录时才会落盘输出（例如游戏 crate 的 `build.rs`
通过 `compiler::compile_dirs`）。

## 文件类型与产物

| 输入 | 要求 | 编译产物 |
|---|---|---|
| `dark.theme` | 至少一个 `@theme` 块 | 每个 `@theme <name>` → `<name>.json`（`{"name", "tokens"}`） |
| `battle.style` | 至少一个 `@style` 块 | `_auto_styles.json`（独立的 `.style` 文件总是包装为 `_auto` 场景，与文件名无关；解析出的继承链一并包含在内） |
| `.scene` 中的内联 `@theme` | — | `<scene name>_theme_<i>.json` |
| `.scene` 中的内联 `@style` | — | `<scene name>_styles.json` |

所有产物都带有一个 `// @generated` 头部，后面跟着 JSON。

## 使用主题与样式的方式

1. **独立文件**——`*.theme` / `*.style` 放在 `data/` 或 DSL 目录下的任意位置；
   `dotzuki check` 会编译它们。
2. **内联块**——放在 `.scene` 顶层的 `@theme` / `@style`，随场景一并编译。
3. **从 GUI 引用**——`.gui` / `ui {}` 组件通过 `style = "<name>"` 应用样式；主题 token
   在属性值中以 `@theme.<key>` 的形式引用（该值原样传入 JSON，由消费方/渲染器解释）。

一个最小的独立主题：

```dsl
@theme dark {
    primary    = "#c9a03d"
    background = "#1a1a2e"
    text       = "#eeeeee"
}
```

## 相关页面

- [主题与样式语法参考](../reference/dsl/theme-style.md)
- [GUI DSL 参考](../reference/dsl/gui.md)
- [DSL codegen 约定](../reference/dsl/codegen.md)
