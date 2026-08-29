# Debug Server

> - **Audience**: rust developers
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.5.4

The wire protocol and runtime contract of the [debug server](./glossary.md)
(`dotzuki_app::debug_server`, `crates/dotzuki-app/src/debug_server/`): a TCP
JSON-line endpoint that lets tests and tooling drive and inspect a running
native game.

## What it is

The debug server exposes a running native game to external drivers: state
snapshots, warps, button injection, deterministic frame stepping, save, and
bag access. It is generic over the game's command type
`C: DeserializeOwned` — the game owns its debug protocol, the engine owns
the TCP and channel machinery. Native only
(`#[cfg(not(target_arch = "wasm32"))]`), no Cargo feature.

The module splits into `protocol` (the wire types) and `server` (the
TCP/channel machinery), and re-exports `CoreDebugCommand`, `DebugResponse`,
`DebugServer`, and `DebugServerHandle`. The engine ships no in-repo
consumers; this is a game-facing API.

## Wire protocol

One serde-JSON document per line in each direction; blank lines are skipped.

Requests are commands: `{"cmd": "<snake_case>", ...fields}`.

```json
{"cmd":"warp","map":"pallet","x":3,"y":4}
```

*Verified by `core_commands_parse_from_wire_json` in
`crates/dotzuki-app/src/debug_server/protocol.rs`.*

Responses are the three-part `DebugResponse` envelope (`ok`, plus optional
`error` / `data`, each skipped when `None`):

```json
{"ok":true}
{"ok":false,"error":"boom"}
{"ok":true,"data":{"x":1}}
```

*Verified by `response_serializes_three_part_envelope` in
`crates/dotzuki-app/src/debug_server/protocol.rs`.*

A line that fails to parse gets
`{"ok":false,"error":"invalid command: ..."}` and the connection survives.
If the game-loop command channel is disconnected, the server answers
`{"ok":false,"error":"game loop command channel disconnected"}` and returns
from the client handler.

## Core commands

`CoreDebugCommand` (`crates/dotzuki-app/src/debug_server/protocol.rs`)
serializes as `#[serde(tag = "cmd", rename_all = "snake_case")]`:

| `cmd` | Fields | Effect |
|---|---|---|
| `get_state` | — | Full game state snapshot |
| `get_position` | — | Map, coordinates, facing |
| `get_bag` | — | Bag items with quantities |
| `get_flags` | — | All script flags |
| `warp` | `map`, `x`, `y` | Warp to a map and coordinates |
| `press` | `button` | Press one button for one frame |
| `press_sequence` | `buttons` | Press a sequence of buttons, one per frame |
| `run_frames` | `count` | Run N frames without processing player input; schedules frames on the real-time loop |
| `step_frames` | `count` | Synchronous: drives `update()` in a tight loop inside the handler, so the state is fully advanced and deterministic when the response arrives; queued `press` / `press_sequence` inputs are consumed one per stepped frame |
| `get_npcs` | — | NPC runtime states on the current map |
| `save` | — | Save the game to file |
| `set_flag` | `name`, `value` | Set a script flag |
| `give_item` | `item`, `qty` | Give an item to the bag |

## Running the server

`DebugServer::new(port)` binds `0.0.0.0:port` — reachable from other
machines, not only localhost — and returns the server plus a
`DebugServerHandle`. `local_addr()` reports the bound address (use port `0`
in tests). `run()` is the blocking accept loop; call it on a background
thread. One client at a time: each connection is handled to completion
before the next accept.

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

## The game-loop side

`DebugServerHandle<C>` is the game loop's half of the server:

- `poll_commands() -> Vec<C>` — non-blocking drain of every command queued
  since the last poll.
- `send_response(DebugResponse)` — non-blocking over an unbounded channel;
  never blocks the game loop.

The game loop must answer every polled command, or the client waits up to
the response timeout (see below).

## Extending the command set

serde internally-tagged enums cannot be extended, so a game defines its own
top-level command type as an `#[serde(untagged)]` wrapper and runs
`DebugServer` over it. The wire format stays `{"cmd": ...}`:

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

## Timeouts and FIFO ordering

The response timeout is 300 seconds: long synchronous commands
(`step_frames` with a big frame budget) legitimately run a minute or more in
debug builds. Requests and responses correlate by FIFO order only — there
are no request IDs. Before forwarding each parsed command, the server drains
any already-queued stale responses, so a late response from a timed-out
command cannot be delivered as the next command's answer. On timeout the
client receives `{"ok":false,"error":"timeout waiting for game loop
response"}` and the connection continues.

## Gotchas

- One client at a time: a second connection waits until the first closes.
- No request IDs — FIFO correlation; the stale-response drain is the only
  skew protection.
- The game loop must answer every polled command, or the client waits up to
  300 seconds.
- `send_response` is fire-and-forget: a disconnected TCP side only logs a
  warning.
- The listener binds `0.0.0.0`, so it is reachable from other machines, not
  only localhost.
