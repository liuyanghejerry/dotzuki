# 调试服务器

> 本文是 `reference/debug-server.md` 的中文翻译，同步至引擎版本 v0.5.4（源文档 commit 3133fb419ae3bc6e5c08bbbcd43ac7fa0289e44f）。
> 内容以英文源为准；发现不一致请更新英文源再同步翻译。

> - **Audience**: rust developers
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.5.4

[调试服务器](./glossary.md)（`dotzuki_app::debug_server`，
`crates/dotzuki-app/src/debug_server/`）的线路协议与运行时契约：一个 TCP
JSON 行端点，让测试与工具驱动、检查一个正在运行的原生游戏。

## 它是什么

调试服务器把正在运行的原生游戏暴露给外部驱动方：状态快照、传送、按键注入、
确定性的逐帧步进、存档与背包访问。它对游戏的命令类型 `C: DeserializeOwned`
泛型——游戏拥有自己的调试协议，引擎拥有 TCP 与通道机制。仅原生平台
（`#[cfg(not(target_arch = "wasm32"))]`），无 Cargo feature。

模块分为 `protocol`（线路类型）与 `server`（TCP/通道机制）两部分，并再导出
`CoreDebugCommand`、`DebugResponse`、`DebugServer` 与 `DebugServerHandle`。
引擎仓库内没有消费方；这是面向游戏的 API。

## 线路协议

每个方向都是每行一个 serde-JSON 文档；空行跳过。

请求是命令：`{"cmd": "<snake_case>", ...fields}`。

```json
{"cmd":"warp","map":"pallet","x":3,"y":4}
```

*Verified by `core_commands_parse_from_wire_json` in
`crates/dotzuki-app/src/debug_server/protocol.rs`.*

响应是三段式 `DebugResponse` 信封（`ok`，加上可选的 `error` / `data`，为
`None` 时各自省略）：

```json
{"ok":true}
{"ok":false,"error":"boom"}
{"ok":true,"data":{"x":1}}
```

*Verified by `response_serializes_three_part_envelope` in
`crates/dotzuki-app/src/debug_server/protocol.rs`.*

解析失败的行会得到 `{"ok":false,"error":"invalid command: ..."}`，连接保持
存活。如果游戏循环侧的命令通道已断开，服务器应答
`{"ok":false,"error":"game loop command channel disconnected"}` 并从客户端
处理函数返回。

## 核心命令

`CoreDebugCommand`（`crates/dotzuki-app/src/debug_server/protocol.rs`）按
`#[serde(tag = "cmd", rename_all = "snake_case")]` 序列化：

| `cmd` | 字段 | 效果 |
|---|---|---|
| `get_state` | — | 完整游戏状态快照 |
| `get_position` | — | 地图、坐标、朝向 |
| `get_bag` | — | 背包物品及数量 |
| `get_flags` | — | 全部脚本 flag |
| `warp` | `map`、`x`、`y` | 传送到指定地图与坐标 |
| `press` | `button` | 按下一个按键，持续一帧 |
| `press_sequence` | `buttons` | 按序列按键，每帧一个 |
| `run_frames` | `count` | 不处理玩家输入地运行 N 帧；帧被排到实时循环上 |
| `step_frames` | `count` | 同步：在处理函数内以紧凑循环驱动 `update()`，响应到达时状态已完全推进且确定；已入队的 `press` / `press_sequence` 输入按每个步进帧一条被消费 |
| `get_npcs` | — | 当前地图上的 NPC 运行时状态 |
| `save` | — | 把游戏存档写入文件 |
| `set_flag` | `name`、`value` | 设置一个脚本 flag |
| `give_item` | `item`、`qty` | 给背包一件物品 |

## 运行服务器

`DebugServer::new(port)` 绑定 `0.0.0.0:port`——其他机器也能连上，不限于
localhost——并返回服务器加一个 `DebugServerHandle`。`local_addr()` 报告绑定
地址（测试中用 `0` 端口）。`run()` 是阻塞的 accept 循环；在后台线程上调用
它。一次只服务一个客户端：每个连接被处理到结束，才接受下一个。

```rust
use dotzuki_app::debug_server::{CoreDebugCommand, DebugResponse, DebugServer};

// Startup: bind on an OS-assigned port and serve on a background thread.
let (server, handle) = DebugServer::<CoreDebugCommand>::new(0).unwrap();
let _addr = server.local_addr().unwrap();
std::thread::spawn(move || server.run());

// Game loop, once per frame: drain every queued command and answer it.
for cmd in handle.poll_commands() {
    let response = match cmd {
        CoreDebugCommand::StepFrames { count } => {
            DebugResponse::ok_with_data(serde_json::json!({ "stepped": count }))
        }
        _ => DebugResponse::ok(),
    };
    handle.send_response(response);
}
```

*Verified by `server_roundtrip_over_loopback` in `crates/dotzuki-app/src/debug_server/server.rs`.*

## 游戏循环侧

`DebugServerHandle<C>` 是游戏循环持有的那一半：

- `poll_commands() -> Vec<C>`——非阻塞地排空自上次轮询以来入队的全部命令。
- `send_response(DebugResponse)`——经无界通道非阻塞发送；永远不会阻塞游戏
  循环。

游戏循环必须应答每一条轮询到的命令，否则客户端会一直等到响应超时（见下）。

## 扩展命令集

serde 的内部标签枚举无法被扩展，因此游戏把自己的顶层命令类型定义为
`#[serde(untagged)]` 包装，并让 `DebugServer` 跑在它上面。线路格式保持
`{"cmd": ...}` 不变：

<!-- not verified -->
```rust
use dotzuki_app::debug_server::CoreDebugCommand;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
enum MyGameDebugCommand {
    StartEncounter { species: String, level: u8 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
enum DebugCommand {
    Core(CoreDebugCommand),
    Game(MyGameDebugCommand),
}

// The server then runs over the wrapper:
// let (server, handle) = DebugServer::<DebugCommand>::new(7777).unwrap();
```

## 超时与 FIFO 顺序

响应超时为 300 秒：耗时长的同步命令（带大帧数预算的 `step_frames`）在
debug 构建里跑上一分钟或更久是正当的。请求与响应仅靠 FIFO 顺序关联——
没有请求 ID。服务器在转发每条解析出的命令之前，会排空所有已入队的过期响应，
因此超时命令迟到的响应不会被当成下一条命令的答案发出去。超时时客户端收到
`{"ok":false,"error":"timeout waiting for game loop response"}`，连接继续。

## 注意事项

- 一次一个客户端：第二个连接要等第一个关闭。
- 没有请求 ID——FIFO 关联；过期响应排空是唯一的防串线保护。
- 游戏循环必须应答每一条轮询到的命令，否则客户端最长等 300 秒。
- `send_response` 是发后即忘：TCP 侧断开时只记录一条警告。
- listener 绑定 `0.0.0.0`，因此其他机器也能连上，不限于 localhost。
