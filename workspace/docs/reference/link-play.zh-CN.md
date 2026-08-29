# 联机（Link Play）

> 本文是 `reference/link-play.md` 的中文翻译，同步至引擎版本 v0.5.4（源文档 commit 3133fb419ae3bc6e5c08bbbcd43ac7fa0289e44f）。
> 内容以英文源为准；发现不一致请更新英文源再同步翻译。

> - **Audience**: rust developers
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.5.4

[联机](./glossary.md)的接线方式：引擎的零 I/O [传输层](./glossary.md)接缝、
`dotzuki-app` 里的原生 TCP 传输层与[会话路由器](./glossary.md)，以及
`dotzuki-web` 里的 Web `BroadcastChannel` 传输层。

## 引擎接缝

`dotzuki_engine::link`（`crates/dotzuki-engine/src/link/mod.rs`）是零 I/O 的
[接缝](./glossary.md)：没有平台调用，没有 Cargo feature，可在 wasm 上编译。
游戏拥有自己的线路协议——消息类型 `M`，通常是一个 serde 枚举——引擎拥有
一切与传输层无关的部分。

### `NetworkTransport<M>`

双向消息传输层。方法语义与 `std::sync::mpsc` 一致：

| 方法 | 行为 |
|---|---|
| `send(&mut self, msg: M)` | 向对端发送一条消息 |
| `recv(&mut self)` | 阻塞，直到消息到达或连接失败 |
| `try_recv(&mut self)` | 永不阻塞：空时返回 `Ok(None)`，对端消失后返回 `Err(Disconnected)` |

`M` 是类型参数（而非关联类型），因此 trait 对象可以写成
`dyn NetworkTransport<MyMessage>`。

### `TransportError`

| 变体 | `Display` 字符串 |
|---|---|
| `Disconnected` | `peer disconnected` |
| `Timeout` | `operation timed out` |
| `SerializationError(String)` | `serialization error: {e}` |
| `IoError(String)` | `I/O error: {e}` |

`TransportError` 不实现 `std::error::Error`。

### `ChannelTransport<M>`

用于本地游玩与测试的内存传输层对：`ChannelTransport::new_pair()` 返回一条
连接的两端。发送永远不会回环给发送者自己；丢弃一端会让另一端报告
`Disconnected`，与关闭的 socket 行为一致。

### `LinkRole`

`Host` / `Guest`——本地玩家在连接的哪一侧，供带非对称握手的协议使用
（经典的 internal/external clock 之分）。游戏把它映射到自己的角色上。

### 编解码器与线路约定

`dotzuki_engine::link::codec`（`crates/dotzuki-engine/src/link/codec.rs`）是
共享的 JSON 行帧编解码，纯 serde：

- `encode_line<T: Serialize>(&T) -> Result<String, TransportError>`——一个
  JSON 文档，不带结尾换行；`\n` 由传输层自己添加。
- `decode_line<T: DeserializeOwned>(&str) -> Result<T, TransportError>`——
  解析一个 JSON 文档。
- `Frame<M> { pub from: String, pub msg: M }`——广播信封：随机的每会话发送者
  标签加上消息本体。`Frame::is_self(&self, my_tag)` 识别发送者自己的回声。

线路约定是每行一个 serde-JSON 文档——与[调试服务器](./glossary.md)的约定
相同。点对点传输层（TCP）发送裸消息 `M`；广播传输层（`BroadcastChannel`）
发送 `Frame` 包裹的信封。裸消息无法按 `Frame` 解码，因此 TCP 与
`BroadcastChannel` 对端在线路上不能直接互通。

## 原生：TCP 传输层

`dotzuki_app::link::transport`（`crates/dotzuki-app/src/link/transport.rs`），
仅原生平台（`#[cfg(not(target_arch = "wasm32"))]`），无 Cargo feature。
纯 `std::net` TCP 加换行分帧的 JSON——没有 async 运行时。

`TcpTransport<M: Serialize + DeserializeOwned + Send + 'static>` 持有一个已
连接的 socket：

- `TcpTransport::connect(addr: SocketAddr)`——客户端侧；阻塞直到 TCP 连接
  建立。
- `TcpTransport::from_stream(TcpStream)`——包装一个已连接的流。它强制切回
  阻塞模式（从非阻塞 listener 接受来的 socket 会继承 `O_NONBLOCK`），并设置
  `set_nodelay(true)`。接受来的 socket 要用它包装。
- 发送 = 在互斥锁下 `encode_line` + 写入 + `\n` + flush。类型为
  `BrokenPipe`、`ConnectionReset`、`ConnectionAborted` 或 `NotConnected` 的写
  错误映射为 `Disconnected`；其余 I/O 失败映射为 `IoError`。
- 接收跑在名为 `link-reader` 的后台读线程上，向一个 `mpsc` 通道喂消息，因此
  `try_recv` 与 `ChannelTransport` 行为一致：空时 `Ok(None)`，对端消失后
  `Err(Disconnected)`。
- 读线程丢弃格式错误的行并记录警告日志，然后继续；换行分帧不会失步。
- Drop 会关闭 socket 并 join 读线程；此后 `try_recv` 确定性地报告
  `Disconnected`。

`LinkServer<M>` 是宿主侧：

- `LinkServer::new(addr)` 以非阻塞模式绑定 listener；`local_addr()` 返回绑定
  地址（测试中用 `0` 端口）。
- `accept() -> Result<Option<TcpTransport<M>>, TransportError>` 是非阻塞的：
  没有待接入的对端时返回 `Ok(None)`。每帧轮询一次。
- 设计上只接单个对端：`accept` 返回传输层后就丢弃 server。

传输层不跑握手——握手由游戏的驱动器与状态机负责，引擎用 `LinkRole` 提供
主/客非对称身份。

## 原生：会话路由器

`dotzuki_app::link::session`（`crates/dotzuki-app/src/link/session.rs`），在
所有目标上编译。`LinkSession<M: Clone + 'static>` 持有真实传输层，并按类型
把每条进来的消息路由到按活动划分的子队列，让对战与交易两套流程共存于一条
连接。会话本身不持有任何游戏逻辑。

- `LinkSession::new(transport, classify, disconnect_msg)`——游戏提供装箱的
  `dyn NetworkTransport<M>`、一个分类函数 `fn(&M) -> Activity`，以及自己协议
  的断线消息。
- `Activity` 是路由类别：`Battle`、`Trade` 或 `Both`。`Both` 是广播类（线路
  上的断线消息）：消息进入每个子队列，并关闭会话。
- `battle_transport()` / `trade_transport()` 把廉价的 `QueueTransport` 克隆交给
  游戏的驱动器；这些克隆与会话共享队列和真实传输层。
- `poll() -> Option<String>`——每帧调用一次，在轮询驱动器之前。它把
  `try_recv` 能取到的消息全部排入队列。在传输层失败的那帧，它返回
  `Some(reason)`、关闭会话，并把 `disconnect_msg` 排入两个队列，让两个驱动器
  都收到断线事件。
- `disconnect()` 发送线路断线消息、把会话标记为关闭，并把 `disconnect_msg`
  排入两个队列。socket 保持打开，直到最后一个传输层持有者被丢弃。
- `is_closed()` 报告关闭状态。

`QueueTransport<M>` 是交给驱动器的传输层。它先服务自己被路由到的队列；
`try_recv` 永不落到真实传输层上（会话是唯一读者）。`recv` 只在队列为空时
才落到真实传输层——在会话内不要使用阻塞式 `recv`。

## Web：`BroadcastChannel` 传输层

`dotzuki_web::link`（`crates/dotzuki-web/src/link.rs`），在 `link` Cargo
feature 之后（默认关闭；引入 `web-sys` 的 `BroadcastChannel` / `MessageEvent`
与 `js-sys`）。传输层本身仅限 wasm32；`Frame` 的再导出在所有目标上编译，
游戏因此可以在原生侧验证线路契约。

`BroadcastChannelTransport<M: Serialize + DeserializeOwned + Send + 'static>`：

- `new(channel_name: &str)` 加入频道——投递立即开始；握手是游戏的事。它生成
  一个随机的约 53 位十六进制标签，并安装一个 `onmessage` 闭包：用
  `Frame::is_self` 过滤自己的回声，把对端消息转发进一个 `mpsc` 通道。
- `tag() -> &str` 返回每会话标签。
- `send` 把消息包进 `Frame { from: tag, msg }`，用 `encode_line` 编码后作为
  JS 字符串投递。`recv` 阻塞；`try_recv` 与 `ChannelTransport` 行为一致。
- Drop 关闭频道并丢弃监听器；已入队的帧仍会先排空，之后 `try_recv` 才报告
  `Disconnected`。

房间模型：频道名就是房间，且恰好两个参与者共用一个名字——协议没有寻址
能力，第三个标签页会收到双方的消息。每个会话使用一个新的随机名字。格式错误
或外来的帧被丢弃并记录警告日志。标签碰撞时（约 53 位空间，概率极低）双方会
把对方的帧当成自己的而过滤掉，握手停滞——但不会损坏数据。

web crate 没有测试（仅 wasm）；`Frame` 契约由引擎的编解码器测试在原生侧
验证。

## 示例

传输层对的往返：

```rust
use dotzuki_engine::link::{ChannelTransport, NetworkTransport};

let (mut a, mut b) = ChannelTransport::new_pair();
a.send("hello".to_string()).unwrap();
assert_eq!(b.recv().unwrap(), "hello");
b.send("world".to_string()).unwrap();
assert_eq!(a.recv().unwrap(), "world");
```

*Verified by `round_trip_send_recv` in `crates/dotzuki-engine/src/link/mod.rs`.*

经由 `LinkSession` 路由消息：

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

## 注意事项

- `LinkSession` 要求 `M: Clone + 'static`：断线消息会被克隆进两个队列。
- 每帧轮询会话一次，且在轮询驱动器的子传输层之前；在驱动器轮询期间到达的
  消息于下一帧路由。
- `LinkServer` 设计上只接单个对端——`accept` 成功后即丢弃它。
- 接受来的 socket 要用 `TcpTransport::from_stream` 包装：它们会从非阻塞
  listener 继承 `O_NONBLOCK`。
- 在会话内不要对 `QueueTransport` 调用阻塞式 `recv`；会话是真实传输层的唯一
  读者。
- 互斥锁中毒表现为 `IoError("link transport lock poisoned")`。
- 裸格式（TCP）与信封格式（`BroadcastChannel`）的线路格式不可互换——不做
  重新包装就不要桥接两者。
