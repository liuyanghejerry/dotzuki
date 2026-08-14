# Scene DSL 参考（`.scene`）

> 本文是 `reference/dsl/scene.md` 的中文翻译，同步至引擎版本 v0.1.0（源文档 commit 3133fb419ae3bc6e5c08bbbcd43ac7fa0289e44f）。
> 内容以英文源为准；发现不一致请更新英文源再同步翻译。

`.scene` 剧情文件的权威语法——场景结构、变量、剧情线、对话、选项、控制流与 trigger
绑定——以 `dotzuki-engine-dsl` 解析与编译的实现为准。

> - **Audience**: DSL authors
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.1.0

本页按代码实现来描述[游戏 DSL](../glossary.md) 的 `.scene` 文件；当代码与旧文档不一致时，
以代码为准。`文件:行号` 引用均相对于仓库中的 `crates/dotzuki-engine-dsl/src/`。各构造
编译成什么，见 [codegen 约定](./codegen.md)；场景内的 `ui { }` 块见
[GUI DSL 参考](./gui.md)；`@theme` / `@style` / `@atlas` 见
[主题与样式参考](./theme-style.md)。分步上手见[快速入门](../../tutorials/quickstart.md)。

## 文件结构

一个 `.scene` 文件包含一个 `game_scene <Name> { ... }` 文档（parser.rs:665-729）：

```dsl
game_scene StartTown {
    @storylines {
        @speaker("Guide") { "Welcome to StartTown!" }
    }
}
```

花括号内，以下块可以任意顺序出现：

- `@variables { ... }`——场景变量
- `@storylines { ... }`——未命名剧情线（一个 `main` 函数）
- `@storyline("name") { ... }`——带 `@trigger` 绑定的具名剧情线
- `@load { ... }`——场景入口处理器（至多一个）
- `ui { ... }`——内联 UI 布局
- `@theme` / `@style` / `@atlas` 块

没有 import 或 include 语句；每个 `.scene` 文件独立编译。编译器按扩展名发现文件
（compiler.rs:74）。顶层的 `screen` 与 `component` 形式属于 `.gui` 文件而非场景
（parser.rs:568-596）；见 [GUI DSL 参考](./gui.md)。

## 词法规则

- **注释**——`//` 到行尾，`/* ... */` 跨行（lexer.rs:348-374）。
- **块与缩进**——花括号界定每个块。词法器仍会强制缩进规范：每层 2 或 4 个空格，单位
  必须贯穿整个文件保持一致，tab 会被拒绝（lexer.rs:168-178、328-346）。缩进 token
  从不改变花括号块的含义；解析器会跳过它们（parser.rs:172-179）。
- **字符串**——`"..."` 或 `'...'`，支持转义 `\n`、`\t`、`\r`、`\\`、`\"`、`\'`
  （lexer.rs:376-400）。
- **数字**——十进制（可选小数部分）与 `0x` 十六进制；前导 `-` 会并入字面量
  （lexer.rs:402-436）。
- **标识符**——字母、数字、`_`、`.`、`-`（lexer.rs:438-447）。`true` / `false` 是布尔
  字面量，`game_scene` / `screen` / `ui` 是保留字（lexer.rs:449-458）。
- **指令**——`@name` token（lexer.rs:460-489）。可识别的名字：`variables`、`theme`、
  `style`、`atlas`、`storylines`、`storyline`、`load`、`speaker`、`say`、`choice`、
  `option`、`run`、`if`、`else`、`each`、`command`、`trigger`、`t`。任何其他 `@name`
  会词法化为文本为 `@name` 的标识符 token，从而解析为以该字面量为名字的裸命令
  （lexer.rs:487；parser.rs:1218-1245）——见[裸命令](#裸命令)。

## 表达式

表达式出现在 `@variables` 初始化器、`@if` 条件、赋值、命令实参、`@speaker` / `@say`
名字、`@each` 来源与 `@trigger` 值中。

- **字面量**——字符串、数字、`true`、`false`（parser.rs:377-384）。
- **数组**——`[a, b, c]`（parser.rs:399-423）。
- **对象**——`{ key: value, ... }` 解析为对象字面量（parser.rs:424-451）。JS codegen
  原样输出它们（js_storyline.rs:132-138）；原生解释器会报错拒绝它们，所以在解释器
  路径上不要使用（interpreter.rs:670-674）。
- **变量与调用**——`name` 与 `name(arg, ...)`（parser.rs:385-393、464-488）。调用编译
  时带 `game.` 前缀。DSL 没有成员访问，所以要写 `getFlag("X")` 而不是
  `game.getFlag("X")`（js_storyline.rs:99-109）。
- **圆括号**用于分组子表达式（parser.rs:394-398）。

运算符优先级，从最高到最低：

| 优先级 | 运算符 | Parser |
|---|---|---|
| 一元 | `!` `-` | parser.rs:357-375 |
| 乘法 | `*` `/` | parser.rs:329-347 |
| 加法 | `+` `-` | parser.rs:309-327 |
| 比较 | `<` `>` `<=` `>=` | parser.rs:279-307 |
| 相等 | `==` `!=` | parser.rs:259-277 |
| 按位与 | `&` | parser.rs:249-257 |
| 逻辑与 | `&&` | parser.rs:239-247 |
| 按位或 | `\|` | parser.rs:229-237 |
| 逻辑或 | `\|\|` | parser.rs:219-227 |
| 三元 | `cond ? a : b` | parser.rs:203-217 |

运行时语义与 JavaScript 对齐：

- `==` / `!=` 严格比较，绝不跨类型（interpreter.rs:111-119）。
- `&&` / `||` 短路求值并返回其中一个操作数（interpreter.rs:718-733）。
- `&` / `|` 把两侧经 JS `ToInt32` 转换（interpreter.rs:121-129、817-818）。
- `<` `>` `<=` `>=` 转换为数字（interpreter.rs:811-814）。
- 任一侧为文本时 `+` 拼接，否则做数字加法（interpreter.rs:799-805）。
- 条件使用 JS 真值规则：`false`、`0`、`NaN`、`""` 与 `undefined` 为假值
  （interpreter.rs:96-106）。

## 顶层块

### `@variables`

`@variables { name = expr }` 声明场景变量。初始化器可以是任意表达式——数字、字符串、
布尔值、数组、基于其他已声明变量的算术（parser.rs:757-778）：

```dsl
game_scene StartTown {
    @variables {
        gold = 500
        name = "RED"
        has_potion = true
        discount = 10 + 5
    }
    @storylines {
        @speaker("Guide") { "Welcome!" }
    }
}
```

声明编译为模块作用域的 `let` 语句，在剧情线函数之前输出（js_variables.rs:21-46）。
调用形式的初始化器会编译为不带 `game.` 前缀的裸调用（js_variables.rs:93-96），所以
初始化器请限于字面量、数组与基于已声明变量的表达式。剧情线中对 `@variables` 名字的
赋值会修改模块作用域的绑定，而不是遮蔽它（js_storyline.rs:543-548）。引用未定义变量
的初始化器是语义错误（parser.rs:1741-1751）。

### `@storylines` —— 未命名剧情线

`@storylines { ... }` 容纳语句；编译器把这条剧情线命名为 `main`（parser.rs:684-692），
并输出 `export async function storyline_main()`（compiler.rs:257-268；
js_storyline.rs:483-513）。

### `@storyline("name")` —— 具名剧情线

具名剧情线先声明 `@trigger` 绑定，再写语句。名字必须是带引号的字符串
（parser.rs:807-840）：

```dsl
game_scene ProfLab {
    @storyline("talkProf") {
        @trigger(map = "ProfLab", npc = 1)
        @speaker("Prof") { "Hello!" }
    }
}
```

`@trigger` 声明必须出现在语句之前（parser.rs:815-833）。一条剧情线可以携带多个
`@trigger`，让多个地图对象路由到同一个处理器（ast.rs:203-207）。每条具名剧情线编译
为 `export async function storyline_<name>()`（js_storyline.rs:494-513）。

### `@load` —— 场景入口

`@load { ... }` 在场景加载时运行。一个场景只允许一个 `@load` 块；出现第二个是解析错误
（parser.rs:697-707）：

```dsl
game_scene ProfLab {
    @load {
        setFlag("LAB_ENTERED")
    }
}
```

它编译为 `export async function <SceneName>OnLoad()`（js_storyline.rs:504-511），并接入
生成的地图配置的 `onLoad` 字段（config_gen.rs:81-83）。

### `ui { }`、`@theme`、`@style`、`@atlas`

- `ui { ... }`——内联 UI 布局（parser.rs:711、1306-1320），编译为 `<SceneName>_ui.json`
  （compiler.rs:296-307）。组件语法见 [GUI DSL 参考](./gui.md)。
- `@theme` / `@style` / `@atlas`——颜色主题、可复用样式与纹理 atlas（parser.rs:708-710）。
  语法与输出见[主题与样式参考](./theme-style.md)。

## 剧情语句

剧情线是一串按顺序执行的语句，每条异步效果都会 await。语句可嵌套在 `@choice` 选项体、
`@if` 分支与 `@each` 体内（parser.rs:1011-1034）。

### `@t` —— 双语文本

[`@t("en", "中文")`](../glossary.md)（双语文本语法）是本地化字符串字面量。实参按位置
排列：第一个是 `en`，第二个是 `zh`（parser.rs:492-495、501-526）。在所有编写文本的
位置使用它——`@speaker` / `@say` 行（parser.rs:1066-1069）与 `@option` 标签
（parser.rs:1096-1101）——也可用于任意表达式位置，此时它解析为本地化字面量并编译为
`game.t("en", "zh")`（parser.rs:381-383；js_storyline.rs:79）。多余的实参可以解析，但
codegen 会忽略（parser.rs:492-495；i18n.rs:10-18）。宿主的当前语言在运行时选择变体，
回退顺序为 `en`，然后是第一对（i18n.rs:10-18；interpreter.rs:613-625）。见
[i18n 指南](../../how-to/i18n.md)。

### `@speaker` —— 玩家发起的对话

`@speaker(name) { "line" ... }` 标记玩家与 NPC 交谈时发起的对话（ast.rs:221-225）。
名字可以是任意表达式；行内容是一个或多个普通字符串或 `@t` 字面量
（parser.rs:1036-1077）：

```dsl
game_scene ProfLab {
    @storylines {
        @speaker("Prof") {
            "Hello!"
            "Welcome to the lab."
        }
        @speaker("") { "The machine hums." }
    }
}
```

名字的行为（js_storyline.rs:197-259）：

- `""`——旁白形式：行内容原样渲染，不带前缀。
- 非空字符串——渲染时带 `"Name: "` 前缀。
- 其他任意表达式——模板字符串，`${name}: text`。

各行用 `\n` 拼接成一次 `await game.showText(...)` 调用（js_storyline.rs:211-256）。

### `@say` —— 过场对白

`@say(name) { "line" ... }` 语法与 `@speaker` 相同，编译出的 `game.showText` 输出也
相同（js_storyline.rs:149-158）。它标记自动触发剧情线内的脚本化对话，NPC 依次发言；
两者区别在语义而非输出（lexer.rs:16-21；ast.rs:226-230）：

```dsl
game_scene ProfLab {
    @storyline("labIntro") {
        @trigger(map = "ProfLab", on_enter = true)
        @say("Prof") { "Hey! Wait!" }
        @say("") { "The professor hands you a device." }
    }
}
```

玩家发起的交谈用 `@speaker`，过场对白用 `@say`。

### `@choice` / `@option`

`@choice { @option(label) { ... } ... }` 弹出一个菜单。标签是普通字符串或 `@t` 字面量；
每个选项体容纳语句（parser.rs:1079-1113）：

```dsl
game_scene StartTown {
    @storylines {
        @choice {
            @option(@t("Ember", "炎")) {
                @speaker("Guide") { @t("A fire type!", "火系！") }
            }
            @option(@t("Dew", "水")) {
                @speaker("Guide") { @t("A water type!", "水系！") }
            }
        }
    }
}
```

一个 choice 编译为 `const choice = await game.showChoice([...]);` 加一条 if/else 链；
最后一个选项是 `else` 分支（js_storyline.rs:266-319）。结果索引越界时执行最后一个
选项（interpreter.rs:364-370）。没有任何 `@option` 的 `@choice` 是语义错误
（parser.rs:1831-1849）。

### `@if` / `@else`

`@if (cond) { ... } @else { ... }` 基于表达式分支。`@else @if (cond) { ... }` 链式
写法可用（parser.rs:1115-1187）：

```dsl
game_scene StartTown {
    @variables { gold = 500 }
    @storylines {
        @if (gold >= 1000) {
            @speaker("Clerk") { "You are wealthy!" }
        } @else @if (gold >= 100) {
            @speaker("Clerk") { "A modest purse." }
        } @else {
            @speaker("Clerk") { "Short on coins." }
        }
    }
}
```

条件可以调用 `getFlag("X")` 这样的同步查询；条件中出现异步命令在原生解释器中是运行时
错误（interpreter.rs:464-483）。

### `@each`

`@each item in expr { ... }` 对数组的每个元素执行一次循环体。`in` 关键字可选
（parser.rs:1189-1208）：

```dsl
game_scene StartTown {
    @variables { items = ["POTION", "ETHER"] }
    @storylines {
        @each item in items {
            @speaker("") { @t("Found an item!", "发现了道具！") }
        }
    }
}
```

在原生解释器中，来源必须求值为数组（interpreter.rs:484-523）。JS codegen 输出
`for (const item of ...)`（js_storyline.rs:366-396）。旧式的双变量形式
`@each (item, index)` 不存在。

### 赋值

`name = expr` 给局部或模块变量赋值（parser.rs:1210-1216）：

```dsl
game_scene StartTown {
    @variables { gold = 500 }
    @storylines {
        gold = gold - 100
        setFlag("BOUGHT_POTION")
    }
}
```

普通赋值（值不是调用）按源码顺序提升到剧情线函数顶部，因此它们相对对话的顺序无关
紧要（js_storyline.rs:525-571；解释器在 interpreter.rs:264-300 处保持一致）。值为
调用的赋值留在原地并 await，因此 `result = startBattle(...)` 绑定战斗结果
（js_storyline.rs:398-428）。每个被赋值的名字都会预先声明，因此 `@if` / `@choice`
分支内的赋值在分支结束后仍然可见（js_storyline.rs:557-571）。给 `@variables` 名字
赋值会修改模块作用域的变量（js_storyline.rs:543-548）。

### 裸命令

`name(args)`——或带空实参的 `name`——调用 `game` API 函数。任何不是 `name = ...` 的
标识符语句都解析为命令（parser.rs:1011-1034、1218-1245），并编译为
`await game["name"](args...)`（js_storyline.rs:461-481）：

```dsl
game_scene StartTown {
    @storylines {
        giveItem("POTION", 3)
        healParty()
    }
}
```

同步查询的返回值出现在裸命令位置时会被丢弃（interpreter.rs:543-566）；结果有用时请
给调用赋值。无法识别的 `@name(...)` 形式（例如旧式的 `@goto(...)`）也会落到这里，成为
名字包含 `@` 的命令（lexer.rs:487），而 game API 并没有注册这些名字。

### `@command`

`@command("name", args...)` 是指令形式的逃生通道：第一个实参必须是给出 `game` API
函数名的字符串字面量，其余实参原样传递（parser.rs:1252-1304）：

```dsl
game_scene StartTown {
    @storylines {
        @command("giveItem", "POTION", 3)
    }
}
```

它编译为与裸命令相同的 `await game["name"](args...)`（js_storyline.rs:461-481）。

### `@run` —— 原生 JavaScript

`@run { ... }` 内嵌原生 JavaScript。词法器原样捕获整个块并跟踪花括号嵌套
（lexer.rs:497-543），codegen 把这些行内联进生成的 JS（js_storyline.rs:60-74）：

```dsl
game_scene StartTown {
    @storylines {
        @run {
            game.healParty();
        }
    }
}
```

`@run` 在 Boa 脚本路径上可用。原生 AST 解释器会报错拒绝 `@run` 块
（interpreter.rs:524-528）；要在解释器下运行，请把这类逻辑改写成 DSL 语句或原生函数
模块。

## `@trigger` 绑定

`@trigger` 声明具名剧情线如何绑定到地图对象。它必须出现在 `@storyline` 块的语句之前
（parser.rs:815-833）。语法：`@trigger(key = value, ...)`；键值对之间的逗号可选
（parser.rs:961-964）。值是表达式。类型不对的键值会被忽略，未知键也会被忽略
（parser.rs:882-959）。

| Key | 接受的值 | 用途 |
|---|---|---|
| `map` | 字符串 | 路由地图 id（compiler.rs:271-279） |
| `npc` | 数字或数字字符串 | `script_config.json` 中的 NPC 对象/text id（config_gen.rs:28-43） |
| `npc` | 非数字字符串 | `storyline_routes.json` 中的旧式 NPC key（compiler.rs:272-278）；冲突检测按它分组（conflict.rs:38-44） |
| `sign` | 数字或数字字符串 | `script_config.json` 中的 sign 条目（config_gen.rs:45-47） |
| `coord` | `[x, y]` | 一个 coord 事件（config_gen.rs:49-72） |
| `coords` | `[[x, y], ...]` | 多个 coord 事件（config_gen.rs:49-72） |
| `name` | 字符串 | 命名 coord 事件（config_gen.rs:50-70） |
| `toggle` / `toggleId` | 字符串 | NPC `toggleId`（config_gen.rs:34-36） |
| `script` / `scriptId` | 字符串 | NPC `scriptId`（config_gen.rs:37-39） |
| `hidden` / `defaultHidden` | 布尔值 | NPC `defaultHidden`（config_gen.rs:40-42） |
| `no_talk` / `noTalk` | 布尔值 | 省略 NPC talk 处理器（config_gen.rs:31-33） |
| `on_enter` / `onEnter` | 布尔值 | `onEnter` 路由标志（compiler.rs:271-279） |
| `after` | 字符串（剧情线名字） | 路由上的 `after` 字段；两条位于同一（map, npc）且没有 `after` 链的剧情线会产生冲突警告（conflict.rs:26-33）。`after` 所隐含的运行时顺序由消费方游戏实现 <!-- not verified against runtime --> |
| `priority` | 数字 | 存储在 AST 上（ast.rs:176）；没有任何编译输出读取它（compiler.rs:25-34；config_gen.rs:18-99） |

```dsl
game_scene ProfLab {
    @storyline("talkProf") {
        @trigger(
            map = "ProfLab",
            npc = 1,
            toggle = "PROFLAB_PROF",
            script = "PROFLAB_PROF_ID",
            hidden = true
        )
        @speaker("Prof") { "Welcome!" }
    }
    @storyline("readSign") {
        @trigger(map = "ProfLab", sign = 1)
        @speaker("") { "MONSTER LAB" }
    }
    @storyline("northExit") {
        @trigger(map = "ProfLab", coords = [[10, 1], [11, 1]], name = "northExit1")
        @speaker("") { "Wait!" }
    }
}
```

编译期冲突警告（`CONFLICT: ...`）经由 `compile_files` 输出（compiler.rs:602-604）。

## 编译产物

编译一个场景会产出：

- `<SceneName>.js`——模块作用域变量声明、每条剧情线各一个导出的 async 函数加 on-load
  函数，以及 sourcemap 页脚（compiler.rs:233-288）。
- `storyline_routes.json`——由构建管线序列化的路由表（compiler.rs:640-645）。
- `<SceneName>_ui.json`——场景含 `ui { }` 块时产出（compiler.rs:296-307）。
- `script_config.json`——由 `gen_map_config` bin 依据 `@trigger` / `@load` 重新生成的
  地图绑定契约（gen_map_config.rs:14-67；config_gen.rs:102-137）。

精确的 JS 与 JSON 形态见 [codegen 约定](./codegen.md)。

## 与旧文档的差异

愿景文档 [`archive/full-dsl.md`](../../archive/full-dsl.md) 描述了解析器并不具备的
构造。本页只记录代码解析的内容。不属于 `.scene` 的：

- `@characters`、`@keyframes`、`@audio`、`@resources`、`map_layout` 与 `i18n { }` 块。
- Speaker 附加项 `@mood`、`@avatar`、`@pause`、`@play_sound`。
- `@each (item, index) in ...`——只存在 `@each item in ...`。
- 旧式双参数形式 `@speaker(name, mode)`——被拒绝（parser.rs:2181-2197 的 parser 测试）。
- 指令风格的游戏命令，如 `@add_item`、`@give_item`、`@change_scene`、`@show_menu`、
  `@goto`、`@play_bgm`。未知的 `@name` token 会解析为名字里带 `@` 的裸命令
  （lexer.rs:487），而 game API 并没有注册这些名字；请写 `giveItem(...)` 或
  `@command("giveItem", ...)`。
- 对话文本中的 `"{binding}"` 模板插值——带引号的文本就是普通字符串。模板字符串只作为
  GUI 属性值存在，由渲染器解析；见 [GUI DSL 参考](./gui.md)。
- 按钮状态块 `@hover` / `@pressed` / `@disabled` 与响应式 `@media` / `@rtl` / `@ltr`
  块——任何地方都不会解析。

## 参见

- [GUI DSL 参考](./gui.md)
- [主题与样式参考](./theme-style.md)
- [DSL codegen 约定](./codegen.md)
- [i18n 指南](../../how-to/i18n.md)
- [快速入门](../../tutorials/quickstart.md)
- [文档索引](../../index.md)
