# 快速入门 — 5 分钟做出你的第一个零 Rust 游戏

> 本文是 `tutorials/quickstart.md` 的中文翻译，同步至引擎版本 v0.1.0（源文档 commit 3133fb419ae3bc6e5c08bbbcd43ac7fa0289e44f）。
> 内容以英文源为准；发现不一致请更新英文源再同步翻译。

> - **Audience**: game authors
> - **Type**: tutorial
> - **Status**: active
> - **Last verified**: v0.1.0

只用 CLI，五分钟从 `dotzuki new` 走到一个可玩的双语场景。

这是**只用 CLI** 的路径（不用编辑器，不写 Rust）。它生成的项目结构与编辑器 Create
向导一致。编辑器路径见[编辑器教程](./editor-first-game.md)。

**前置条件：** 一个 `dotzuki` 可执行文件（构建一次即可：在 workspace 根目录运行
`cargo build --release --bin dotzuki` —— 产物是 `target/release/dotzuki`）。

## 1. 搭建项目骨架

```bash
dotzuki new my-game
cd my-game
```

这会生成 `.dotzuki-editor.json`（项目清单），外加 `data/`、`gfx/`，以及一个带着第一段
对话的 `assets/scenes/main.scene`。

## 2. 编写一个场景

用**游戏 DSL** 编辑 `assets/scenes/main.scene` —— 对话、选项、条件和命令，全程不用写代码：

```dsl
game_scene Main {
    @variables {
        starter = 0
    }

    @storylines {
        @speaker("Guide") {
            "Welcome to your new JRPG project!"
            "Choose your starter!"
        }
        @choice {
            @option("Ember") {
                @speaker("Guide") {
                    @t("Ember is the fire type!", "炎系的选择！")
                }
            }
            @option("Dew") {
                @speaker("Guide") {
                    @t("Dew is the water type!", "水系的选择！")
                }
            }
        }
    }
}
```

`@t("en", "中文")` 让任何文本都支持双语 —— `dotzuki run --lang zh` 可以切换语言。完整
语法见 [GUI DSL 参考](../reference/dsl/gui.md)和 [DSL codegen 约定](../reference/dsl/codegen.md)。

## 3. 检查能否编译

```bash
dotzuki check .
```

这条命令会在内存中编译所有 DSL 文件并报告诊断信息；退出码为 0 表示场景合法。

## 4. 玩起来

```bash
dotzuki run .
```

操作：**Arrows/WASD** 移动，**Z** = 确认/对话，**X** = 取消/跑步，**Enter/Space** =
Start 菜单，**Backspace** = Select。

用热重载迭代开发：

```bash
dotzuki run . --watch      # scenes + map reload as you save files
```

## 接下来读什么

- **项目结构与项目清单** —— [项目清单与项目结构](../reference/project-manifest.md)
- **所有 CLI flag** —— [CLI 参考](../reference/cli.md)
- **战斗规则（`rules.ron`）** —— [战斗规则指南](../how-to/battles.md)
- **带 AI Story Designer 的编辑器** —— [编辑器 README](../../tools/dotzuki-editor/README.md)
- **完整文档索引** —— [文档索引](../index.md)
