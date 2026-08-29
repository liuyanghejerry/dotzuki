# DSL 运行时加载参考

> 本文是 `reference/dsl/runtime-loading.md` 的中文翻译，同步至引擎版本 v0.5.4（源文档 commit 3133fb419ae3bc6e5c08bbbcd43ac7fa0289e44f）。
> 内容以英文源为准；发现不一致请更新英文源再同步翻译。

> - **Audience**: rust developers
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.5.4

`dotzuki_engine_dsl::disk_loader`
（`crates/dotzuki-engine-dsl/src/disk_loader.rs`）中以磁盘为后端的
[场景](../glossary.md) provider 在运行时从目录树编译 `.scene` 文件，
并支持基于 mtime 的[热重载](../glossary.md)。本页定义目录布局约定、
两个 provider 与重载协议。

## 它是什么

`disk_loader` 是 `crate::loader` 构建期内嵌路径的运行时对应物：它
不再 `include!` 预编译产物，而是现场编译 `.scene` 源文件，因此游戏
可以把引擎指向一个 scripts 目录（例如 `--scripts-dir` CLI 参数），
无需重新构建即可迭代场景。该模块没有 feature 开关，构建于
`std::fs` 之上。

`.scene` 文件编译成什么属于 [codegen](../glossary.md) 约定，定义在
[DSL codegen 约定](./codegen.md)；本页覆盖的是如何从磁盘加载这些
编译产物并保持其最新。

两个 provider 对应 DSL 的两个执行目标（disk_loader.rs:188-280）：

| Provider | 执行目标 | 存储内容 | `shared/` 模块 | `disk_mode` 标志 |
|---|---|---|---|---|
| `SceneAstProvider` | 原生 AST [解释器](../glossary.md) | `GameScene` AST | 是 | 是 |
| `SceneScriptProvider` | JavaScript 引擎 | 编译后的 JS 源码 | 否 | 否 |

两个 provider 目前在仓库内都没有消费方；它们是面向游戏的 API。
`dotzuki-runner` 通过 `compiler::compile_files` +
`loader::register_compiled` 加载 DSL 场景，不经过这些 provider。
纯 `.js` 文件另有独立的加载器
`dotzuki_engine_script::loader::ScriptLoader`，它不读取 `.scene`
源文件。

## 目录布局约定

根目录由调用方注入；provider 在其下发现场景：

```
<dir>/
├── StartTown/
│   └── script.scene     # 场景 id 为 "StartTown"
├── shared/
│   └── center.scene     # 场景 id 为 "shared/center"（仅 AST provider）
└── notes.txt            # 被忽略
```

- `<dir>/<scene-id>/script.scene`——每个子目录一个场景；场景 id 即
  子目录名。
- `<dir>/shared/<name>.scene`——共享模块，注册在场景 id
  `shared/<name>` 下；仅 AST provider。
- 非 `.scene` 文件与没有 `script.scene` 的子目录会被忽略（由
  `ast_provider_loads_map_and_shared_scenes` 验证——该测试加载的目录
  同时含有 `notes.txt` 和一个没有场景的 `EmptyDir/`）。

## `SceneAstProvider`

面向原生 AST 解释器的磁盘 provider——不需要 JavaScript 引擎
（disk_loader.rs:188-239）。引自 disk_loader.rs:188-197：

```rust
pub struct SceneAstProvider {
    pub scenes: HashMap<String, GameScene>,
    pub file_meta: HashMap<String, SceneFileMeta>,
    pub disk_mode: bool,
}
```

方法：

| 方法 | 返回 | 含义 |
|---|---|---|
| `new()` | `Self` | 空 provider，`disk_mode == false` |
| `get_scene(map_id)` | `Option<&GameScene>` | 查询编译后的 AST |
| `has_scene(map_id)` | `bool` | 存在性检查 |
| `load_from_directory(dir)` | `Result<usize, String>` | 编译发现的每个场景；成功时返回场景数 |
| `check_reload()` | `Vec<String>` | 重编译 mtime 已前进的文件；返回磁盘上变化的 id |

`SceneFileMeta` 记录每个被跟踪文件的 `path: PathBuf` 与最近一次
已知的 `modified: SystemTime`（disk_loader.rs:28-31）。

### `disk_mode` 遮蔽语义

- `load_from_directory` 在检查 `dir` 是否存在*之前*就设置
  `disk_mode = true`（disk_loader.rs:216-219）。目录缺失或不是目录时
  返回 `Ok(0)`——但仍会把 `disk_mode` 打开（由
  `ast_provider_missing_dir_loads_zero_but_enters_disk_mode` 验证）。
- `disk_mode` 为 true 时，provider 来自 scripts 目录，并**整体遮蔽
  内嵌 AST**——全有或全无，与 JS loader 的约定一致。
- 为 false 时，`scenes` 只保存运行时注入/覆盖，未命中则回退到内嵌
  AST。

## `SceneScriptProvider`

面向 JavaScript 脚本路径的磁盘 provider（disk_loader.rs:244-280），
方法形态与 AST provider 相同，区别是：

- `scenes: HashMap<String, String>` 存编译后的 JS 源码；
  `get_script(map_id)` 返回 `Option<&str>`（`has_script` 是存在性
  检查）。
- 没有 `disk_mode` 字段。
- 不读取 `shared/` 目录——JS 路径没有共享模块约定（由
  `script_provider_loads_js_and_ignores_shared_dir` 验证）。

## 加载语义

`load_from_directory(dir)`
（disk_loader.rs:118-141、216-234、265-275）：

- `dir` 缺失或不是目录时返回 `Ok(0)`——但 AST provider 的
  `disk_mode` 设置顺序见上。
- AST provider 先编译共享文件，再编译地图场景。
- 第一个读取或编译错误会中止整批加载；错误信息会指明出错的文件。

## 热重载协议

`check_reload()`（disk_loader.rs:147-182）：

- 重编译每个磁盘上 mtime 相比加载时**严格前进**的被跟踪文件。
- 重新读取或重编译失败的文件**保留旧版本**；被跟踪的 mtime 只在
  重编译成功时前进，因此失败的文件会在下次调用时重试。
- 返回值列出的是**在磁盘上发生变化**的场景 id，无论重编译成功与否。
  调用方不得把返回的 id 当作"已重载"。
- 文件未改动时 provider 不报告任何变化（由
  `check_reload_is_quiet_until_a_file_changes` 验证）；JS provider
  遵循同一协议（由
  `script_provider_check_reload_recompiles_changed_files` 验证）。

## 示例

加载一个含一个地图场景和一个共享模块的 scripts 目录：

```rust
use std::path::Path;

use dotzuki_engine_dsl::disk_loader::SceneAstProvider;

let mut provider = SceneAstProvider::new();
let count = provider.load_from_directory(Path::new("assets/scripts")).unwrap();
assert_eq!(count, 2); // StartTown + shared/center
assert!(provider.disk_mode);
assert!(provider.has_scene("StartTown"));
assert!(provider.has_scene("shared/center"));
```

*Verified by `ast_provider_loads_map_and_shared_scenes` in
`crates/dotzuki-engine-dsl/src/disk_loader.rs`.*

在某个场景文件于磁盘上被编辑后轮询变化：

```rust
let mut provider = SceneAstProvider::new();
provider.load_from_directory(Path::new("assets/scripts")).unwrap();

// Later, after `StartTown/script.scene` changed on disk:
let changed = provider.check_reload();
assert_eq!(changed, vec!["StartTown".to_string()]);
let town = provider.get_scene("StartTown").expect("StartTown AST");
assert!(town.storylines.iter().any(|s| s.name == "intro_v2"));
// The tracked mtime now matches the file, so the next poll is quiet.
assert!(provider.check_reload().is_empty());
```

*Verified by `ast_provider_check_reload_recompiles_changed_files` in
`crates/dotzuki-engine-dsl/src/disk_loader.rs`.* 该测试在重写文件前
把被跟踪的 mtime 强制设为 `SystemTime::UNIX_EPOCH`，以规避文件系统
时间戳粒度的影响。

## 注意事项

- **第一个错误中止整批。** 任何一个文件读不出或编译不过，整个
  `load_from_directory` 调用都会失败。
- **wasm32 的 `disk_mode` 陷阱。** 该模块未做 cfg 门控但基于
  `std::fs`；在 wasm32 上 `is_dir()` 为 false，于是
  `load_from_directory` 返回 `Ok(0)`——而 AST provider 仍会进入
  `disk_mode`，把*所有*内嵌 AST 遮蔽成空。这里没有任何 `#[cfg]`
  防护（不像 `dotzuki-engine-script` 的 loader 以 `not(wasm32)`
  做了 cfg 门控）。同一份代码也要为 [WASM 运行器](../glossary.md)
  目标构建时，请在调用点自行防护。
- **AST/JS 不对称。** `shared/` 模块与 `disk_mode` 标志只存在于 AST
  provider；JS provider 只编译地图场景。
