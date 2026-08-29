# Rust API 门户

> 本文是 `reference/rustdoc.md` 的中文翻译，同步至引擎版本 v0.5.4（源文档 commit 3133fb419ae3bc6e5c08bbbcd43ac7fa0289e44f）。
> 内容以英文源为准；发现不一致请更新英文源再同步翻译。

> - **Audience**: rust developers
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.5.4

crate 一览以及每个 crate 的 API 文档所在位置；rustdoc 是权威的 API 参考，下面
的页面是相应的文字说明。

所有 `dotzuki-*` crate 共享同一个版本（目前是 `0.5.4`）并发布在 crates.io
上，因此它们的 API 文档位于 docs.rs。本地副本：

```bash
cd workspace
cargo doc --workspace --no-deps --open
```

## Crate 一览

| Crate | 用途 | API 文档 | 文字文档 |
|---|---|---|---|
| `dotzuki-engine` | 核心 trait（`GameData`）、tilemap/相机/触发器、战斗效果栈、物品/商店/装备、大地图表现动画、联机 codec | [docs.rs](https://docs.rs/dotzuki-engine) | [架构](../explanation/architecture.md)、[效果栈](../explanation/effect-stack.md)、[商店](shops.md)、[大地图表现动画](overworld-presentation.md)、[联机](link-play.md) |
| `dotzuki-rules` | 声明式战斗规则：RON → 效果栈 | [docs.rs](https://docs.rs/dotzuki-rules) | [战斗规则](battle-rules.md) |
| `dotzuki-rules-macro` | `dotzuki-rules` 的 derive/辅助工具 | [docs.rs](https://docs.rs/dotzuki-rules-macro) | [战斗规则](battle-rules.md) |
| `dotzuki-engine-tiled` | Tiled `.tmx`（JSON）→ 引擎类型 | [docs.rs](https://docs.rs/dotzuki-engine-tiled) | [地图指南](../how-to/maps.md) |
| `dotzuki-engine-script` | 基于 Boa 的异步 JS 脚本 | [docs.rs](https://docs.rs/dotzuki-engine-script) | [i18n 指南](../how-to/i18n.md) |
| `dotzuki-engine-dsl` | 游戏 DSL 编译器（`.scene`/`.gui`/`.theme`/`.style`）+ 运行时编译 API + 带热重载的磁盘场景 provider | [docs.rs](https://docs.rs/dotzuki-engine-dsl) | [scene](dsl/scene.md)、[gui](dsl/gui.md)、[theme & style](dsl/theme-style.md)、[codegen](dsl/codegen.md)、[运行时加载](dsl/runtime-loading.md) |
| `dotzuki-renderer` | GB 风格的 tile/文字渲染器、CJK 字体、PNG → tile 数据资源管线（`resource` feature） | [docs.rs](https://docs.rs/dotzuki-renderer) | [gui](dsl/gui.md)、[资源管理器](resource-manager.md) |
| `dotzuki-ui` | 基于 `Painter` trait 的 UI 组件 | [docs.rs](https://docs.rs/dotzuki-ui) | [gui](dsl/gui.md) |
| `dotzuki-audio` | 音频抽象层 + GB-APU 音序器 + 逐帧管理器 + 设备输出（`cpal` / `web-audio` feature） | [docs.rs](https://docs.rs/dotzuki-audio) | [音频指南](../how-to/audio.md)、[音频命令](audio-commands.md)、[音频运行时](audio-runtime.md) |
| `dotzuki-app` | 原生应用外壳（窗口/循环/热重载）+ 原生联机传输与会话路由 + TCP 调试服务器 | [docs.rs](https://docs.rs/dotzuki-app) | [联机](link-play.md)、[调试服务器](debug-server.md) |
| `dotzuki-tui` | 终端外壳（ratatui） | [docs.rs](https://docs.rs/dotzuki-tui) | — |
| `dotzuki-runner` | 零 Rust 项目运行时 + 无头模式驱动 | [docs.rs](https://docs.rs/dotzuki-runner) | [项目清单](project-manifest.md) |
| `dotzuki-runner-web` | 运行器的 WASM 构建（编辑器 Play） | [docs.rs](https://docs.rs/dotzuki-runner-web) | [发布指南](../how-to/publishing.md) |
| `dotzuki-cli` | `dotzuki` 二进制：`new` / `check` / `run` | [docs.rs](https://docs.rs/dotzuki-cli) | [CLI 参考](cli.md) |
| `dotzuki-web` | WASM 桥：编辑器布局预览、游戏外壳（`game-shell` feature）、BroadcastChannel 联机传输（`link` feature） | [docs.rs](https://docs.rs/dotzuki-web) | [游戏外壳](game-shell.md)、[联机](link-play.md) |

crates.io 发布集之外的工具：

| 工具 | 用途 | 文档 |
|---|---|---|
| `tools/dotzuki-editor` | 游戏无关的 Vue/Vite 编辑器、AI Story Designer、编辑器内 Play | [编辑器 README](../../tools/dotzuki-editor/README.md) |
| `tools/asset-converter` | 2bpp → RGBA tileset + Tiled `.tsx` 转换器 | [README](../../tools/asset-converter/README.md) |
| `tools/editor-extensions` | VSCode DSL 语法高亮 | `tools/editor-extensions` |
| `dotzuki-template/` | cargo-generate 起始模板 | [README](../../dotzuki-template/README.md) |
