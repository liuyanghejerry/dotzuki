# Scene DSL Reference (`.scene`)

The authoritative syntax of `.scene` story files — scene structure, variables,
storylines, dialogue, choices, control flow, and trigger bindings — as parsed
and compiled by `dotzuki-engine-dsl`.

> - **Audience**: DSL authors
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.1.0

This page describes the [Game DSL](../glossary.md) `.scene` file as the code
implements it; where code and older documents disagree, the code wins.
File:line citations are relative to `crates/dotzuki-engine-dsl/src/` in the
repository. For what each construct compiles to, see the
[codegen contract](./codegen.md); for the `ui { }` block inside a scene, see
[the GUI DSL reference](./gui.md); for `@theme` / `@style` / `@atlas`, see
[the theme & style reference](./theme-style.md). For a step-by-step
walkthrough, see [the quickstart](../../tutorials/quickstart.md).

## File structure

A `.scene` file holds one `game_scene <Name> { ... }` document
(parser.rs:665-729):

```dsl
game_scene StartTown {
    @storylines {
        @speaker("Guide") { "Welcome to StartTown!" }
    }
}
```

Inside the braces, these blocks may appear in any order:

- `@variables { ... }` — scene variables
- `@storylines { ... }` — the unnamed storyline (one `main` function)
- `@storyline("name") { ... }` — a named storyline with `@trigger` bindings
- `@load { ... }` — the scene-entry handler (at most one)
- `ui { ... }` — an inline UI layout
- `@theme` / `@style` / `@atlas` blocks

There is no import or include statement; every `.scene` file compiles on its
own. The compiler discovers files by extension (compiler.rs:74). The
top-level `screen` and `component` forms belong to `.gui` files, not scenes
(parser.rs:568-596); see [the GUI DSL reference](./gui.md).

## Lexical rules

- **Comments** — `//` to end of line, `/* ... */` across lines
  (lexer.rs:348-374).
- **Blocks and indentation** — braces delimit every block. The lexer still
  enforces indentation hygiene: 2 or 4 spaces per level, the unit must stay
  consistent across the file, and tabs are rejected (lexer.rs:168-178,
  328-346). Indent tokens never change what a brace block means; the parser
  skips them (parser.rs:172-179).
- **Strings** — `"..."` or `'...'` with escapes `\n`, `\t`, `\r`, `\\`,
  `\"`, `\'` (lexer.rs:376-400).
- **Numbers** — decimal with optional fraction, plus `0x` hex; a leading `-`
  lexes into the literal (lexer.rs:402-436).
- **Identifiers** — letters, digits, `_`, `.`, `-`
  (lexer.rs:438-447). `true` / `false` are boolean literals, and
  `game_scene` / `screen` / `ui` are reserved words (lexer.rs:449-458).
- **Directives** — `@name` tokens (lexer.rs:460-489). Recognized names:
  `variables`, `theme`, `style`, `atlas`, `storylines`, `storyline`, `load`,
  `speaker`, `say`, `choice`, `option`, `run`, `if`, `else`, `each`,
  `command`, `trigger`, `t`. Any other `@name` lexes as an identifier token
  whose text is `@name`, so it parses as a bare command with that literal
  name (lexer.rs:487; parser.rs:1218-1245) — see
  [Bare commands](#bare-commands).

## Expressions

Expressions appear as `@variables` initializers, `@if` conditions,
assignment values, command arguments, `@speaker` / `@say` names, `@each`
sources, and `@trigger` values.

- **Literals** — strings, numbers, `true`, `false` (parser.rs:377-384).
- **Arrays** — `[a, b, c]` (parser.rs:399-423).
- **Objects** — `{ key: value, ... }` parses as an object literal
  (parser.rs:424-451). The JS codegen emits them verbatim
  (js_storyline.rs:132-138); the native interpreter rejects them with an
  error, so avoid them on the interpreter path (interpreter.rs:670-674).
- **Variables and calls** — `name` and `name(arg, ...)` (parser.rs:385-393,
  464-488). Calls compile with a `game.` prefix. The DSL has no member
  access, so write `getFlag("X")`, not `game.getFlag("X")`
  (js_storyline.rs:99-109).
- **Parentheses** group subexpressions (parser.rs:394-398).

Operator precedence, tightest first:

| Precedence | Operators | Parser |
|---|---|---|
| unary | `!` `-` | parser.rs:357-375 |
| multiplication | `*` `/` | parser.rs:329-347 |
| addition | `+` `-` | parser.rs:309-327 |
| comparison | `<` `>` `<=` `>=` | parser.rs:279-307 |
| equality | `==` `!=` | parser.rs:259-277 |
| bitwise and | `&` | parser.rs:249-257 |
| logical and | `&&` | parser.rs:239-247 |
| bitwise or | `\|` | parser.rs:229-237 |
| logical or | `\|\|` | parser.rs:219-227 |
| ternary | `cond ? a : b` | parser.rs:203-217 |

Runtime semantics mirror JavaScript:

- `==` / `!=` compare strictly, never across kinds (interpreter.rs:111-119).
- `&&` / `||` short-circuit and return one of the operands
  (interpreter.rs:718-733).
- `&` / `|` coerce both sides through JS `ToInt32`
  (interpreter.rs:121-129, 817-818).
- `<` `>` `<=` `>=` coerce to numbers (interpreter.rs:811-814).
- `+` concatenates when either side is text, otherwise adds numbers
  (interpreter.rs:799-805).
- Conditions use JS truthiness: `false`, `0`, `NaN`, `""`, and `undefined`
  are falsy (interpreter.rs:96-106).

## Top-level blocks

### `@variables`

`@variables { name = expr }` declares scene variables. Initializers may be
any expression — numbers, strings, booleans, arrays, arithmetic over other
declared variables (parser.rs:757-778):

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

The declarations compile to module-scoped `let` statements emitted before
the storyline functions (js_variables.rs:21-46). A call initializer compiles
to a bare call without the `game.` prefix (js_variables.rs:93-96), so keep
initializers to literals, arrays, and expressions over declared variables.
Storyline assignments to a `@variables` name mutate the module-scoped
binding instead of shadowing it (js_storyline.rs:543-548). An initializer
that references an undefined variable is a semantic error
(parser.rs:1741-1751).

### `@storylines` — the unnamed storyline

`@storylines { ... }` holds statements; the compiler names this storyline
`main` (parser.rs:684-692) and emits `export async function
storyline_main()` (compiler.rs:257-268; js_storyline.rs:483-513).

### `@storyline("name")` — named storylines

A named storyline declares `@trigger` bindings, then statements. The name
must be a quoted string (parser.rs:807-840):

```dsl
game_scene ProfLab {
    @storyline("talkProf") {
        @trigger(map = "ProfLab", npc = 1)
        @speaker("Prof") { "Hello!" }
    }
}
```

`@trigger` declarations must come before statements (parser.rs:815-833). A
storyline may carry more than one `@trigger` so several map objects route to
one handler (ast.rs:203-207). Each named storyline compiles to
`export async function storyline_<name>()` (js_storyline.rs:494-513).

### `@load` — scene entry

`@load { ... }` runs when the scene loads. A scene allows one `@load` block;
a second is a parse error (parser.rs:697-707):

```dsl
game_scene ProfLab {
    @load {
        setFlag("LAB_ENTERED")
    }
}
```

It compiles to `export async function <SceneName>OnLoad()`
(js_storyline.rs:504-511) and is wired into the generated map config's
`onLoad` field (config_gen.rs:81-83).

### `ui { }`, `@theme`, `@style`, `@atlas`

- `ui { ... }` — an inline UI layout (parser.rs:711, 1306-1320), compiled to
  `<SceneName>_ui.json` (compiler.rs:296-307). Component syntax lives in
  [the GUI DSL reference](./gui.md).
- `@theme` / `@style` / `@atlas` — color themes, reusable styles, and
  texture atlases (parser.rs:708-710). Syntax and output in
  [the theme & style reference](./theme-style.md).

## Story statements

A storyline is a sequence of statements, run in order, awaiting each async
effect. Statements nest inside `@choice` option bodies, `@if` branches, and
`@each` bodies (parser.rs:1011-1034).

### `@t` — bilingual text

[`@t("en", "中文")`](../glossary.md) is a localized string literal. Arguments
are positional: first is `en`, second is `zh` (parser.rs:492-495, 501-526).
Use it where text is authored — `@speaker` / `@say` lines
(parser.rs:1066-1069) and `@option` labels (parser.rs:1096-1101) — and in
any expression position, where it parses as a localized literal and compiles
to `game.t("en", "zh")` (parser.rs:381-383; js_storyline.rs:79). Extra
arguments parse but codegen ignores them (parser.rs:492-495; i18n.rs:10-18).
The host's current language selects the variant at runtime, falling back to
`en`, then the first pair (i18n.rs:10-18; interpreter.rs:613-625). See
[the i18n guide](../../how-to/i18n.md).

### `@speaker` — player-initiated dialogue

`@speaker(name) { "line" ... }` marks dialogue the player initiates by
talking to an NPC (ast.rs:221-225). The name is any expression; the lines
are one or more plain strings or `@t` literals (parser.rs:1036-1077):

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

Name behavior (js_storyline.rs:197-259):

- `""` — narrator form: the lines render verbatim, with no prefix.
- a non-empty string — rendered with a `"Name: "` prefix.
- any other expression — a template literal, `${name}: text`.

The lines join with `\n` into one `await game.showText(...)` call
(js_storyline.rs:211-256).

### `@say` — cutscene speech

`@say(name) { "line" ... }` has the same syntax and compiles to the same
`game.showText` output as `@speaker` (js_storyline.rs:149-158). It marks
scripted dialogue inside an auto-triggered storyline, where NPCs talk in
sequence; the two statements differ in meaning, not output (lexer.rs:16-21;
ast.rs:226-230):

```dsl
game_scene ProfLab {
    @storyline("labIntro") {
        @trigger(map = "ProfLab", on_enter = true)
        @say("Prof") { "Hey! Wait!" }
        @say("") { "The professor hands you a device." }
    }
}
```

Use `@speaker` for player-initiated talk and `@say` for cutscene lines.

### `@choice` / `@option`

`@choice { @option(label) { ... } ... }` presents a menu. The label is a
plain string or `@t` literal; each option body holds statements
(parser.rs:1079-1113):

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

A choice compiles to `const choice = await game.showChoice([...]);` plus an
if/else chain; the last option is the `else` branch (js_storyline.rs:266-319).
An out-of-range result index runs the last option (interpreter.rs:364-370).
A `@choice` with no `@option` is a semantic error (parser.rs:1831-1849).

### `@if` / `@else`

`@if (cond) { ... } @else { ... }` branches on an expression. `@else @if
(cond) { ... }` chains work (parser.rs:1115-1187):

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

Conditions may call sync queries such as `getFlag("X")`; an async command in
the condition is a runtime error in the native interpreter
(interpreter.rs:464-483).

### `@each`

`@each item in expr { ... }` runs the body once per array element. The `in`
keyword is optional (parser.rs:1189-1208):

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

The source must evaluate to an array in the native interpreter
(interpreter.rs:484-523). The JS codegen emits `for (const item of ...)`
(js_storyline.rs:366-396). The legacy two-variable form `@each (item,
index)` does not exist.

### Assignment

`name = expr` assigns a local or module variable (parser.rs:1210-1216):

```dsl
game_scene StartTown {
    @variables { gold = 500 }
    @storylines {
        gold = gold - 100
        setFlag("BOUGHT_POTION")
    }
}
```

Plain assignments (whose value is not a call) hoist to the top of the
storyline function, in source order, so their order relative to dialogue
does not matter (js_storyline.rs:525-571; the interpreter mirrors this at
interpreter.rs:264-300). Call-valued assignments stay in place and are
awaited, so `result = startBattle(...)` binds the battle outcome
(js_storyline.rs:398-428). Every assigned name is pre-declared, so
assignments inside `@if` / `@choice` branches stay visible after the branch
(js_storyline.rs:557-571). Assigning a `@variables` name mutates the
module-scoped variable (js_storyline.rs:543-548).

### Bare commands

`name(args)` — or `name` with no arguments — calls a `game` API function.
Any identifier statement that is not `name = ...` parses as a command
(parser.rs:1011-1034, 1218-1245) and compiles to
`await game["name"](args...)` (js_storyline.rs:461-481):

```dsl
game_scene StartTown {
    @storylines {
        giveItem("POTION", 3)
        healParty()
    }
}
```

A sync query's return value in bare-command position is discarded
(interpreter.rs:543-566); assign the call when the result matters.
Unrecognized `@name(...)` forms (for example legacy `@goto(...)`) also land
here as commands whose name includes the `@` (lexer.rs:487), which the game
API does not register.

### `@command`

`@command("name", args...)` is the directive escape hatch: the first
argument must be a string literal giving the `game` API function name, and
the remaining arguments pass through (parser.rs:1252-1304):

```dsl
game_scene StartTown {
    @storylines {
        @command("giveItem", "POTION", 3)
    }
}
```

It compiles to the same `await game["name"](args...)` as a bare command
(js_storyline.rs:461-481).

### `@run` — raw JavaScript

`@run { ... }` embeds raw JavaScript. The lexer captures the block verbatim,
tracking brace nesting (lexer.rs:497-543), and the codegen inlines the lines
into the generated JS (js_storyline.rs:60-74):

```dsl
game_scene StartTown {
    @storylines {
        @run {
            game.healParty();
        }
    }
}
```

`@run` works on the Boa script path. The native AST interpreter rejects
`@run` blocks with an error (interpreter.rs:524-528); port such logic to DSL
statements or a native function module to run under the interpreter.

## `@trigger` bindings

`@trigger` declares how a named storyline binds to map objects. It must
appear before statements in a `@storyline` block (parser.rs:815-833).
Syntax: `@trigger(key = value, ...)`; commas between pairs are optional
(parser.rs:961-964). Values are expressions. A key given a value of the
wrong kind is ignored, and unknown keys are ignored (parser.rs:882-959).

| Key | Accepted value | Consumed as |
|---|---|---|
| `map` | string | route map id (compiler.rs:271-279) |
| `npc` | number or numeric string | NPC object/text id in `script_config.json` (config_gen.rs:28-43) |
| `npc` | non-numeric string | legacy NPC key in `storyline_routes.json` (compiler.rs:272-278); conflict detection groups on it (conflict.rs:38-44) |
| `sign` | number or numeric string | sign entry in `script_config.json` (config_gen.rs:45-47) |
| `coord` | `[x, y]` | one coord event (config_gen.rs:49-72) |
| `coords` | `[[x, y], ...]` | several coord events (config_gen.rs:49-72) |
| `name` | string | names the coord events (config_gen.rs:50-70) |
| `toggle` / `toggleId` | string | NPC `toggleId` (config_gen.rs:34-36) |
| `script` / `scriptId` | string | NPC `scriptId` (config_gen.rs:37-39) |
| `hidden` / `defaultHidden` | bool | NPC `defaultHidden` (config_gen.rs:40-42) |
| `no_talk` / `noTalk` | bool | omits the NPC talk handler (config_gen.rs:31-33) |
| `on_enter` / `onEnter` | bool | `onEnter` route flag (compiler.rs:271-279) |
| `after` | string (storyline name) | `after` field on the route; two same-(map, npc) storylines with no `after` chain warn as a conflict (conflict.rs:26-33). The runtime sequencing `after` implies happens in the consuming game <!-- not verified against runtime --> |
| `priority` | number | stored on the AST (ast.rs:176); no compiler output reads it (compiler.rs:25-34; config_gen.rs:18-99) |

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

Compile-time conflict warnings (`CONFLICT: ...`) surface through
`compile_files` (compiler.rs:602-604).

## Compiled output

Compiling a scene produces:

- `<SceneName>.js` — module-scoped variable declarations, one exported
  async function per storyline plus the on-load function, and a sourcemap
  footer (compiler.rs:233-288).
- `storyline_routes.json` — the routing table serialized by the build
  pipeline (compiler.rs:640-645).
- `<SceneName>_ui.json` — when the scene has a `ui { }` block
  (compiler.rs:296-307).
- `script_config.json` — the map binding contract regenerated from
  `@trigger` / `@load` by the `gen_map_config` bin
  (gen_map_config.rs:14-67; config_gen.rs:102-137).

Exact JS and JSON shapes are in [the codegen contract](./codegen.md).

## Divergence from legacy documents

The vision document [`archive/full-dsl.md`](../../archive/full-dsl.md)
describes constructs the parser does not have. This page documents what the
code parses. Not part of `.scene`:

- `@characters`, `@keyframes`, `@audio`, `@resources`, `map_layout`, and
  `i18n { }` blocks.
- Speaker extras `@mood`, `@avatar`, `@pause`, `@play_sound`.
- `@each (item, index) in ...` — only `@each item in ...` exists.
- The legacy two-argument form `@speaker(name, mode)` — rejected
  (parser tests at parser.rs:2181-2197).
- Directive-style game commands such as `@add_item`, `@give_item`,
  `@change_scene`, `@show_menu`, `@goto`, `@play_bgm`. Unknown `@name`
  tokens parse as bare commands with the `@` in the name (lexer.rs:487),
  which the game API does not register; write `giveItem(...)` or
  `@command("giveItem", ...)`.
- `"{binding}"` template interpolation in dialogue text — quoted text is a
  plain string. Template strings exist as GUI property values, resolved by
  the renderer; see [the GUI DSL reference](./gui.md).
- Button state blocks `@hover` / `@pressed` / `@disabled` and responsive
  `@media` / `@rtl` / `@ltr` blocks — not parsed anywhere.

## See also

- [GUI DSL reference](./gui.md)
- [Theme & style reference](./theme-style.md)
- [DSL codegen contract](./codegen.md)
- [i18n guide](../../how-to/i18n.md)
- [Quickstart](../../tutorials/quickstart.md)
- [Documentation index](../../README.md)
