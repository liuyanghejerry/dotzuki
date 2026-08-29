# Link Play

> - **Audience**: rust developers
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.5.4

How [link play](./glossary.md) is wired: the engine's zero-I/O
[transport](./glossary.md) seam, the native TCP transport and
[session router](./glossary.md) in `dotzuki-app`, and the web
`BroadcastChannel` transport in `dotzuki-web`.

## The engine seam

`dotzuki_engine::link` (`crates/dotzuki-engine/src/link/mod.rs`) is the
zero-I/O [seam](./glossary.md): no platform calls, no Cargo feature, and it
compiles on wasm. The game owns its wire protocol — a message type `M`,
typically a serde enum — and the engine owns everything transport-agnostic.

### `NetworkTransport<M>`

A bidirectional message transport. The methods mirror `std::sync::mpsc`
semantics:

| Method | Behavior |
|---|---|
| `send(&mut self, msg: M)` | Send one message to the peer |
| `recv(&mut self)` | Block until a message arrives or the connection fails |
| `try_recv(&mut self)` | Never blocks: `Ok(None)` when empty, `Err(Disconnected)` once the peer is gone |

`M` is a type parameter (not an associated type), so trait objects read as
`dyn NetworkTransport<MyMessage>`.

### `TransportError`

| Variant | `Display` string |
|---|---|
| `Disconnected` | `peer disconnected` |
| `Timeout` | `operation timed out` |
| `SerializationError(String)` | `serialization error: {e}` |
| `IoError(String)` | `I/O error: {e}` |

`TransportError` does not implement `std::error::Error`.

### `ChannelTransport<M>`

The in-memory transport pair for local play and tests:
`ChannelTransport::new_pair()` returns the two ends of one connection.
Sends never loop back to the sender, and dropping one end makes the other
report `Disconnected`, matching a closed socket.

### `LinkRole`

`Host` / `Guest` — which side of the connection the local player is, for
protocols with an asymmetric handshake (the classic internal/external clock
distinction). Games map it onto their own roles.

### The codec and the wire convention

`dotzuki_engine::link::codec` (`crates/dotzuki-engine/src/link/codec.rs`) is
the shared JSON-line framing, pure serde:

- `encode_line<T: Serialize>(&T) -> Result<String, TransportError>` — one
  JSON document, no trailing newline; transports add the `\n` themselves.
- `decode_line<T: DeserializeOwned>(&str) -> Result<T, TransportError>` —
  parse one JSON document.
- `Frame<M> { pub from: String, pub msg: M }` — the broadcast envelope: a
  random per-session sender tag plus the message.
  `Frame::is_self(&self, my_tag)` identifies the sender's own echo.

The wire convention is one serde-JSON document per line — the same
convention as the [debug server](./glossary.md). Point-to-point transports
(TCP) send the bare message `M`; broadcast transports (`BroadcastChannel`)
send the `Frame`-wrapped envelope. A bare message does not decode as a
`Frame`, so TCP and `BroadcastChannel` peers are not directly
wire-compatible.

## Native: TCP transport

`dotzuki_app::link::transport` (`crates/dotzuki-app/src/link/transport.rs`),
native only (`#[cfg(not(target_arch = "wasm32"))]`), no Cargo feature. Plain
`std::net` TCP with newline-framed JSON — no async runtime.

`TcpTransport<M: Serialize + DeserializeOwned + Send + 'static>` owns one
connected socket:

- `TcpTransport::connect(addr: SocketAddr)` — the client side; blocks until
  the TCP connection is established.
- `TcpTransport::from_stream(TcpStream)` — wraps an already-connected
  stream. It forces blocking mode (sockets accepted from the non-blocking
  listener inherit `O_NONBLOCK`) and sets `set_nodelay(true)`. Use it for
  accepted sockets.
- Sends are `encode_line` + write + `\n` + flush under a mutex. Write
  errors of kind `BrokenPipe`, `ConnectionReset`, `ConnectionAborted`, or
  `NotConnected` map to `Disconnected`; other I/O failures map to `IoError`.
- Receives run on a background reader thread (named `link-reader`) feeding
  an `mpsc` channel, so `try_recv` mirrors `ChannelTransport`: `Ok(None)`
  when empty, `Err(Disconnected)` once the peer is gone.
- The reader thread drops malformed lines with a log warning and keeps
  going; newline framing cannot desync.
- Drop shuts the socket down and joins the reader thread; afterwards
  `try_recv` deterministically reports `Disconnected`.

`LinkServer<M>` is the hosting side:

- `LinkServer::new(addr)` binds a non-blocking listener; `local_addr()`
  returns the bound address (use port `0` in tests).
- `accept() -> Result<Option<TcpTransport<M>>, TransportError>` is
  non-blocking: `Ok(None)` while no peer is pending. Poll it once per frame.
- Single-peer by design: once `accept` returns a transport, drop the server.

The transport layer runs no handshake — the game's drivers and state
machines own the handshake, with `LinkRole` for host/guest asymmetry.

## Native: the session router

`dotzuki_app::link::session` (`crates/dotzuki-app/src/link/session.rs`),
compiled on every target. `LinkSession<M: Clone + 'static>` owns the real
transport and routes each incoming message by type into per-activity
sub-queues, so a battle flow and a trade flow coexist on one connection. The
session holds no game logic.

- `LinkSession::new(transport, classify, disconnect_msg)` — the game
  supplies a boxed `dyn NetworkTransport<M>`, a classification function
  `fn(&M) -> Activity`, and its protocol's disconnect message.
- `Activity` is the routing class: `Battle`, `Trade`, or `Both`. `Both` is
  the broadcast class (the wire disconnect): the message is queued into
  every sub-queue and closes the session.
- `battle_transport()` / `trade_transport()` hand cheap `QueueTransport`
  clones to the game's drivers; the clones share the queue and the real
  transport with the session.
- `poll() -> Option<String>` — call once per frame, before polling the
  drivers. It drains `try_recv` into the queues. On the frame the transport
  fails it returns `Some(reason)`, closes the session, and queues
  `disconnect_msg` into both queues, so both drivers surface their
  disconnect event.
- `disconnect()` sends the wire disconnect, marks the session closed, and
  queues `disconnect_msg` into both queues. The socket stays open until the
  last transport holder drops.
- `is_closed()` reports the closed state.

`QueueTransport<M>` is the transport handed to a driver. It serves its
routed queue first; `try_recv` never falls through to the real transport
(the session is the sole reader). `recv` falls through only when the queue
is empty — do not use blocking `recv` inside a session.

## Web: `BroadcastChannel` transport

`dotzuki_web::link` (`crates/dotzuki-web/src/link.rs`), behind the `link`
Cargo feature (off by default; pulls in `web-sys` `BroadcastChannel` /
`MessageEvent` and `js-sys`). The transport itself is wasm32-only; the
`Frame` re-export compiles on every target, so games can verify the wire
contract natively.

`BroadcastChannelTransport<M: Serialize + DeserializeOwned + Send + 'static>`:

- `new(channel_name: &str)` joins the channel — delivery starts immediately;
  the handshake is the game's job. It generates a random ~53-bit hex tag and
  installs an `onmessage` closure that filters the sender's own echo via
  `Frame::is_self` and forwards peer messages into an `mpsc` channel.
- `tag() -> &str` returns the per-session tag.
- `send` wraps the message in `Frame { from: tag, msg }`, encodes it with
  `encode_line`, and posts it as a JS string. `recv` blocks; `try_recv`
  mirrors `ChannelTransport`.
- Drop closes the channel and drops the listener; frames already queued
  still drain before `try_recv` reports `Disconnected`.

Room model: the channel name is the room, and exactly two participants may
share a name — the protocol has no addressing, so a third tab would receive
both sides' messages. Use a fresh random name per session. Malformed or
foreign frames are dropped with a log warning. On a tag collision (rare in
the ~53-bit space) each side filters the other's frames as its own and the
handshake stalls — no data corruption.

The web crate has no tests (wasm-only); the `Frame` contract is tested
natively by the engine codec tests.

## Example

A transport pair round trip:

```rust
use dotzuki_engine::link::{ChannelTransport, NetworkTransport};

let (mut a, mut b) = ChannelTransport::new_pair();
a.send("hello".to_string()).unwrap();
assert_eq!(b.recv().unwrap(), "hello");
b.send("world".to_string()).unwrap();
assert_eq!(a.recv().unwrap(), "world");
```

*Verified by `round_trip_send_recv` in `crates/dotzuki-engine/src/link/mod.rs`.*

Routing messages through a `LinkSession`:

```rust
use dotzuki_app::link::{Activity, LinkSession};
use dotzuki_engine::link::{ChannelTransport, NetworkTransport};

#[derive(Debug, Clone, PartialEq, Eq)]
enum TestMessage {
    Hello,
    RequestTrade,
    Disconnect,
}

fn classify(msg: &TestMessage) -> Activity {
    match msg {
        TestMessage::Hello => Activity::Battle,
        TestMessage::RequestTrade => Activity::Trade,
        TestMessage::Disconnect => Activity::Both,
    }
}

let (t_a, mut t_b) = ChannelTransport::new_pair();
let mut session = LinkSession::new(Box::new(t_a), classify, TestMessage::Disconnect);
let mut battle = session.battle_transport();
let mut trade = session.trade_transport();

// The peer sent a battle message; poll routes it to the battle queue only.
t_b.send(TestMessage::Hello).unwrap();
session.poll();
assert_eq!(battle.try_recv().unwrap(), Some(TestMessage::Hello));
assert_eq!(trade.try_recv().unwrap(), None);
```

*Verified by `sub_transports_route_by_type_only` in `crates/dotzuki-app/src/link/session.rs`.*

## Gotchas

- `LinkSession` requires `M: Clone + 'static`: the disconnect message is
  cloned into both queues.
- Poll the session once per frame, before polling the drivers'
  sub-transports; messages that arrive during driver polls route on the next
  frame.
- `LinkServer` is single-peer by design — drop it once `accept` succeeds.
- Use `TcpTransport::from_stream` for accepted sockets: they inherit
  `O_NONBLOCK` from the non-blocking listener.
- Do not call blocking `recv` on a `QueueTransport` inside a session; the
  session is the sole reader of the real transport.
- Mutex poisoning surfaces as `IoError("link transport lock poisoned")`.
- Bare (TCP) and framed (`BroadcastChannel`) wire formats are not
  interchangeable — do not bridge the two without re-wrapping.
