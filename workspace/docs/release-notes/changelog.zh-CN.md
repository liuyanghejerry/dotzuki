# 变更日志

> 本文是 `release-notes/changelog.md` 的中文翻译，同步至引擎版本 v0.5.4（源文档 commit 3133fb419ae3bc6e5c08bbbcd43ac7fa0289e44f）。
> 内容以英文源为准；发现不一致请更新英文源再同步翻译。

> - **Audience**: rust developers, game authors
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.5.4

引擎版本历史。版本号跟随 workspace 版本（`workspace/Cargo.toml`，所有
`dotzuki-*` crate 共享）；每个 release 都附带一份 `migration/` 目录下的迁移指
南（每个 release 各建一份）。

## 格式

- 每个版本先列出 **breaking changes**（附其迁移指南的链接），然后是值得注意
  的新增与修复。
- 文档正文不提及 "since vX.Y"——本页是版本历史的唯一所在（doc-standard §10）。

## 未发布

- 修复：调试服务器的响应超时从 5s 提高到 300s，且服务器在转发每条命令前会排
  空滞留的过期响应——耗时的同步命令（大帧数预算的 `step_frames`）不会再扰乱
  FIFO 响应流。见[调试服务器参考](../reference/debug-server.md)。

## v0.5.4

workspace 版本回到 v0.5.x tag 序列（0.1.1 → 0.5.4）；版本线的来龙去脉见
[迁移指南](migration/v0.5.4.md)。中间的 `v0.5.2` / `v0.5.3` 两个 tag 在
workspace 版本仍为 0.1.1 时触发了发布工作流的 tag↔version 断言失败，没有发布
任何内容——本 tag 让两者重新对齐。

Breaking changes（都在大地图 NPC API；细节与步骤见
[迁移指南](migration/v0.5.4.md)）：

- `NpcDefinition` 与 `NpcRuntimeState` 新增 `wander_axis: NpcWanderAxis`
  字段——结构体字面量需要补上该字段。
- `advance_step` 不再推进 `repel_steps`；改在游戏自己的遇敌检查门槛里调用新的
  `tick_repel_step` 辅助函数。
- Wander NPC 遵循自己的轴向，不再有半径束缚；NPC 走路节奏为每 tile 16 帧
  （玩家速度的一半）。

从 pokered 游戏仓库下沉进引擎的游戏无关系统：

- `dotzuki-engine`：`items::mart`——交互式商店状态机（`MartState` +
  `MartBackend` + 现成的 `MartDriver`），见[商店](../reference/shops.md)；
  `overworld::presentation`——按帧计数的动画状态机（传送旋转、电梯震动、
  水面/花丛 tile、钓竿、推岩尘土、邮轮离港），见
  [大地图表现动画](../reference/overworld-presentation.md)；`link::codec`——
  共享的 JSON-line 分帧 codec 与广播 `Frame<M>` 信封，见
  [联机](../reference/link-play.md)。
- `dotzuki-engine-dsl`：`disk_loader`——带 mtime 热重载的磁盘场景 provider，
  见[运行时加载](../reference/dsl/runtime-loading.md)。
- `dotzuki-renderer`：`resource` 模块（feature）——PNG → 2bpp/1bpp/4bpp 转
  换、`AssetRoot` 路径解析、`ResourceManager` 素材缓存，以及面向 wasm/移动端
  的内嵌素材接缝，见[资源管理器](../reference/resource-manager.md)。
- `dotzuki-audio`：`manager`——`AudioManager`（音乐淡入淡出、NR50 主音量、
  跨音轨续播状态、帧后钩子）；`output`——`cpal` / `web-audio` feature 门控的
  设备输出，见[音频运行时](../reference/audio-runtime.md)。
- `dotzuki-app`：`debug_server`——通用 TCP JSON-line 调试服务器，见
  [调试服务器](../reference/debug-server.md)；`link`——`TcpTransport` /
  `LinkServer` / `LinkSession` 路由器，见[联机](../reference/link-play.md)。
- `dotzuki-web`：`game_shell` feature——wasm 与原生共用的 pixels+winit 游戏
  循环，见[游戏外壳](../reference/game-shell.md)；`link` feature——
  `BroadcastChannel` 联机传输。
- `dotzuki-ui`：游戏可以向 `FrameBufferPainter` 注入自定义 GB tile 字形。

本 release 还包含：

- 编辑器：原生桌面风格外壳（Lucide 图标）、随 GitHub Release 附带的 Electron
  安装包、云托管支持（相对 base、AI key 回退、优雅停机、健康检查端点）。

## v0.1.1

- runner 的 `modern-audio` feature 带来现代文件音频（WAV/OGG/FLAC/MP3）。
- `dotzuki new --template your-first-game`；编辑器的帮助面板可以在应用内渲染
  reference 页面。
- `dotzuki check` 在缺少 `battle.rules` 时会失败；CLI 会展示 runner 日志。
- 文档站：场景、UI 布局、素材三篇 how-to 指南（中英双语），并补全术语表。

## v0.1.0

首个发布版本（crates.io）。引擎 workspace 的版本线从 v0.5.x 预发布 tag
（`v0.5.0`、`v0.5.1`）重置为 `0.1.0`；每个 `dotzuki-*` crate 以 0.1.0 发布，
并落地 tag 驱动的发布管线：`workspace/scripts/publish-crates.sh`、发布工作流与
package-check PR 门禁。tag `v0.1.0` 的代码只比 `v0.5.1` 多一个提交——这次跳跃
没有 API 变更。预发布时代的消费者按[迁移指南](migration/v0.1.0.md)把 git tag 从
`v0.5.x` 换成 `v0.1.0`（或改成 registry 形式）。
