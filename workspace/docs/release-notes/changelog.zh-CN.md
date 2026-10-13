# 变更日志

> 本文是 `release-notes/changelog.md` 的中文翻译，同步至引擎版本 v0.10.1
>（源文档 commit 9bc4da66b7499e9ff9472913e005932ae7828fb7）。
> 内容以英文源为准；发现不一致请更新英文源再同步翻译。

> - **Audience**: rust developers, game authors
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.10.1

引擎版本历史。版本号跟随 workspace 版本（`workspace/Cargo.toml`，所有
`dotzuki-*` crate 共享）；每个 release 都附带一份 `migration/` 目录下的迁移指
南（每个 release 各建一份）。

## 格式

- 每个版本先列出 **breaking changes**（附其迁移指南的链接），然后是值得注意
  的新增与修复。
- 文档正文不提及 "since vX.Y"——本页是版本历史的唯一所在（doc-standard §10）。

## 未发布

Rust API 破坏性变更：

- `NpcRuntimeState` 新增 `step_direction: Option<Direction>`。空闲 NPC 结构体字面量
  需补上 `step_direction: None`。手工构造行走状态的测试需在此字段保存移动方向。
  二进制存档适配器需处理新增字段。

NPC 移动修复：

- 自动行走和脚本行走的每一步均在开始时保存方向。步子进行中修改 `facing`，
  不再改变剩余移动或其占用的目的格。
- 移动偏移和碰撞预测使用 `NpcRuntimeState::walking_direction()`；
  角色图像朝向继续使用 `facing`。
- JSON 快照保留已保存的移动方向。缺少 `step_direction` 的旧 JSON 会加载为 `None`，
  并使用其保存的朝向。步子完成后移除已保存方向；连续脚本步子独立保存下一步方向。

## v0.10.1

本补丁版本恢复 DSL 在裸机目标上的编译，并纳入 `fix/gba-psg-audio` 消费者使用的 NPC 钩子。
请阅读[迁移指南](migration/v0.10.1.zh-CN.md)。已有 API 保持原有行为，没有破坏性变更。

- 将 DSL 整数检查中不可用的 `f64::fract()` 调用换成兼容 no_std 的检查。
  保留接受的整数范围及对无效参数的拒绝行为。
- CI 在 `thumbv4t-none-eabi` 上检查音频与 DSL 库。
- 在移动遍历中增加可选回调，处理可见且空闲的静止 NPC。
  已有入口保留原有的静止 NPC 行为。
- 用一个预分配向量收集 NPC 占用格，保留碰撞语义。

## v0.10.0

本版本整合此前仅存在于 `fix/gba-psg-audio` 分支的 GBA 音频与游戏行为修复。
请阅读[迁移指南](migration/v0.10.0.zh-CN.md)。

破坏性变更：

- `NpcRuntimeState::delay_counter` 从 `u8` 改为 `u16`，以表示 256 帧倒计时。
  请更新带类型的赋值及二进制存档适配器。

运行时新增与修复：

- 支持关闭默认 feature 的裸机音频，以及向物理 PSG 硬件转发寄存器写入。
  保留稀疏音乐/音效声道的位置，并在音效结束时释放等待状态。
- 修正滑音初始化、小数进位及到达目标后的终止行为。
- 增加显式启用的经典 NPC 游走策略；已有入口保留默认策略。
- 增加每个行动者执行前的回调，以及状态门之后带默认实现的招式解析钩子。
  消费游戏可用它们实现训练师行动和调用招式。
- 向外螺旋转场在有界遍历结束后终止。

## v0.9.1

本补丁版本保持 Rust API 不变，并替换导出的移动端控制布局。
重新生成自定义外壳前，请阅读[迁移指南](migration/v0.9.1.zh-CN.md)。

- Android 和 HarmonyOS 在游戏画面上绘制适配安全区的横屏控件。
  共享的触点归属逻辑支持移动与动作同时输入、保留短按，并在失焦、取消及尺寸变化时释放输入。
- 持久化控件大小、位置、不透明度、镜像布局、浮动方向盘和可选触觉反馈。
  在底部对话上方预留空间，包括较高的 HarmonyOS 屏幕。
- 为游戏自行维护的 iOS 外壳提供可复用的 UIKit Swift package 和接入指南。
- 增加共享 sanitizer 测试、Android 原生 instrumentation 和 iOS 模拟器 CI。
- 修复发布自动化，使其安装受支持的 Android SDK 包。

## v0.9.0

本版本包含不兼容的 UI API 变更，要求 Rust 1.88 或更新版本。
更新消费方前请阅读[迁移指南](migration/v0.9.0.zh-CN.md)。

不兼容变更：

- 移除已弃用的 `DialogConfig`、`FlexMenuConfig`、`YesNoConfig`、旧绘制包装函数，
  以及 flex-menu 的旧 `EdgeInsets`、`Justify`、`SizeMode` 类型。改用 `MenuConfig`
  与当前 widget 绘制函数。
- Static layout 的 `Context::set` 改为返回 `Result<(), ContextCapacityError>`，
  绑定数组满时不再 panic。调用方需处理返回值。

运行时新增与修复：

- 支持配置角色行走/跑步速度，为交通工具或地形覆盖移动速度，并在调用方驱动的
  演出中偏移角色位置。默认速度保持每次 update 2/4 像素。
- Game shell 缓存短按直到下一次 update，并在失焦时清空按住状态和待处理输入。
  一帧内的多次短按会合并。
- 同步 Android 与 Harmony runner 生命周期，拒绝 DSL 数值转换越界，对齐 native
  与 Boa 命令行为，实现 battle hook scope 和 handler 速度排序。

编辑器与验证：

- 支持 cardinal 和 47-mask blob autotile 的可视化 mask 分配、连续绘制/擦除、
  预览及规则原子保存。
- 支持原生分辨率场景素材的透明度感知选择、拖动/微移、撤销/重做、碰撞与事件
  叠加、像素编辑器往返，以及保存 `art.json` 时的 revision 检查。
- 增加编辑器语言选择与延迟加载、GBA 帧预算检查、MSRV/依赖/移动端/浏览器
  CI 门禁，并修正 Android SDK 安装包配置。

## v0.8.2

此补丁版本只新增 trait 实现，没有破坏性变更。使用方更新方式见
[迁移指南](migration/v0.8.2.zh-CN.md)。

- 新增：引擎自身的运行时状态现在可序列化——DSL 解释器（`Interpreter`、
  `InterpState`）、trigger manager、NPC 运行时状态、cutscene manager、连接过场、
  `CommandResult`、`Metatile` 以及 overworld 演出状态实现 `Serialize` 与
  `Deserialize`，DSL `Interpreter` 另有 `Debug` 与 `Clone`。需要逐帧
  `save_state` / `restore_state` 的游戏可以直接对引擎状态下快照并恢复，无需再
  固定一份私有引擎分支。

## v0.8.1

此补丁版本没有 API 变更。使用方更新方式见[迁移指南](migration/v0.8.1.zh-CN.md)。

- 修复：鸿蒙宿主改用分层启动图标（API 11 及以上要求），桌面显示游戏自己的图标
  而不是系统占位图。重新导出宿主即可生效；`dotzuki export --harmony` 模板与
  `scripts/export-mobile-host.py` 都会带上分层位图资源。
- 修复：安卓宿主改用自适应启动图标。manifest 指向 `@mipmap/ic_launcher`，模板
  同时带上 API 26 图层、旧式图标与各屏幕密度的位图。重新导出宿主即可生效。

## v0.8.0

本版本包含破坏性 API 与 feature gate 变更。使用方更新方式见
[迁移指南](migration/v0.8.0.zh-CN.md)。

破坏性变更：

- `FrameBuffer::save_png` 现在需要 `dotzuki-engine/image` feature。
- `dotzuki-engine-script` 中依赖 Boa 的导出现在需要 `script-boa` feature。
  使用默认 feature 的消费方不受影响；关闭默认 feature 的消费方需要
  显式启用它。
- `dotzuki_renderer::mon_icon` 现在需要 renderer 的 `resource` feature。
- Engine 与 DSL 的公开数据结构现在使用所属 crate 的确定性 `HashMap` 和
  `HashSet` alias，不再使用 `std::collections` 类型。
- `StoryStmt` 新增 `Return` variant。穷尽匹配需要处理它。
- 七个 `BattleEffects` 渲染方法新增可推导的 const 存储参数，`Tile` 现在按
  四字节对齐。

GBA 与 renderer 新增内容：

- Engine、DSL、script protocol、renderer、UI、rules、app 与 audio 路径现在可供
  裸机 ARM 消费方以 `no_std + alloc` 编译。
- 索引 framebuffer 提供显式 packed 与 word-aligned linear 存储。
  默认类型在所有目标上保持 packed；`LinearIndexedFrameBuffer` 与
  `LinearRgbaIndexedFrameBuffer` 为 DMA 提供每个调色板索引一个字节的存储。
- 索引 tile blit、裁剪行复制、framebuffer scroll、矩形复制与
  重叠安全的内部搬移降低 CPU 与内存分配压力。
- 瞬态战斗动画状态与 GBA 原地屏幕效果让消费方能够复用稳定帧，不再克隆
  160×144 索引缓冲区。

DSL 与布局新增内容：

- Schema v2 [`静态布局`](../reference/glossary.md)编译器把支持的 `.gui` 画面
  编译为借用式 Rust 布局数据，同时保留 `.gui` 作为创作源。
- 原生 AST core dispatcher 与 capability traversal 统一内建命令校验；
  `return` 现在具有一致的 parser、原生 interpreter 与 JavaScript 语义。

## v0.7.1

此补丁版本没有 API 变更。
使用方更新方式见[迁移指南](migration/v0.7.1.zh-CN.md)。

- 修复：发布的 `dotzuki` CLI 现在包含 Android 和 HarmonyOS 导出模板所需的移动
  ABI C 头文件。通过 crates.io 安装后可直接导出这两类工程，无需源码 checkout。

## v0.7.0

本版本没有破坏性的 API 变更。使用方更新方式见
[迁移指南](migration/v0.7.0.zh-CN.md)。

- Android：`dotzuki export --android` 会写出 arm64 Android Studio 工程，
  通过移动 ABI 版本 1 提供 Kotlin Activity、`Choreographer` 帧时钟、
  `SurfaceView` renderer、`AudioTrack` 输出、触摸控制、生命周期处理和
  `SharedPreferences` 存档。编辑器提供相同的导出入口，发布安装包包含 Android
  运行时静态库。
- 移动端外壳：`scripts/export-mobile-host.py --platform android|harmony` 可以把
  自定义游戏的 `dotzuki-mobile` 静态库包装进任一由引擎维护的外壳。
- CI 会交叉编译 Android 运行时，并组装教程项目的导出 APK。

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
