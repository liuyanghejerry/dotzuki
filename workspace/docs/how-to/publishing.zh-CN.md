# 发布与升级游戏

> 本文是 `how-to/publishing.md` 的中文翻译，同步至引擎版本 v0.12.0（源文档 commit 38e455a39c8453a2c18a4283af7b343c5b586c6f）。
> 内容以英文源为准。

> - **Audience**: game authors, rust developers
> - **Type**: how-to
> - **Status**: active
> - **Last verified**: v0.12.0

零 Rust 项目既可以作为可编辑的目录交付，也可以连同播放器一起导出。
开始前请核对[项目清单](../reference/project-manifest.zh-CN.md)，并在项目根目录运行下文示例。

## 交付可编辑的项目

复制 `.dotzuki-editor.json` 及其指定的数据、图像和场景目录。使用开发游戏时相同版本的
CLI 或编辑器。在复制出来的目录中，校验文件并启动游戏。

```bash
dotzuki check .
dotzuki run .
```

运行器把存档写入项目目录下的 `.dotzuki-save.json`。如果安装目录只读，
用 `dotzuki run . --save-file <writable-path>` 指定可写路径。

## 对项目做冒烟测试

```bash
dotzuki run . --headless --frames 60
dotzuki run . --headless --frames 120 --screenshot boot.png
```

这两条命令都以无头模式运行，无需打开窗口或音频设备。第二条将最后一帧写入 PNG。
加上 `--save` 可以测试游戏到达可存档状态时的写入行为。

## 导出网页版

```bash
dotzuki export --web . --out dist/web
python3 -m http.server --directory dist/web
```

打开 `http://localhost:8000` 即可游玩。将 `dist/web/` 中的文件上传到静态网站即可分享游戏。
该目录包含 `index.html`、`wasm/` 下的 WebAssembly 运行器和 `game.dzpk`。
页面处理键盘输入和 WebAudio，并将存档写入 `localStorage`。在桌面编辑器中，
**试玩 > 导出 Web** 会使用随附的运行器执行同一导出操作。
如果单独安装了 CLI，请用 `--runner-pkg` 指定配套的 WebAssembly 包。

各导出目标都会校验项目。分发前请先修复诊断报告中的问题。用 `--force` 可以导出含有
DSL 错误的包，播放器会在启动时报告这些错误。包中保留项目清单和源文件。通过校验且含有
DSL 文件的项目还会打入[预编译场景数据](../reference/glossary.md#compiled-scene-assets)。
配套播放器按需加载原生函数，旧版播放器可以读取随包源码。
CLI 收集的输入文件每个最多 16 MiB，合计最多 64 MiB。它会跳过构建目录、清单以外的隐藏文件
以及 `*.bak`。生成的场景数据额外占用包空间。完整收集规则见 [CLI 参考](../reference/cli.zh-CN.md)。

如果要编写自己的播放器页面，可以参考导出生成的 `index.html`。

| `WasmRunner` 方法 | 用途 |
|---|---|
| `WasmRunner.fromPack(bytes, saveJson?)` | 从 `Uint8Array` 形式的 `.dzpk` 启动游戏，可同时恢复存档 |
| `new WasmRunner(filesJson, saveJson?, language?)` | 从编辑器提供的 JSON 字符串启动，其中各文件的内容以 base64 编码 |
| `advance(inputBitmask)` | 将游戏模拟和音频推进一帧 |
| `present(ctx, full)` | 将累计变化绘制到 2D 画布。画布尺寸改变或上下文恢复后传入 `true` |
| `tick(inputBitmask)` | 推进一帧并返回完整的 RGBA 快照 |
| `take_audio()` | 取出交错排列的 44.1 kHz 立体声 `f32` 采样 |
| `width()` / `height()` | 读取帧缓冲尺寸（320 × 240） |
| `export_save()` / `import_save(json)` | 在可存档时导出当前状态，或恢复已有存档 |

每个模拟步调用一次 `advance`，之后在保留上次绘制内容的画布上调用一次 `present`。
需要整帧像素的宿主可以使用 `tick`，该方法自身会推进模拟。
输入掩码的第 0 至 7 位依次对应 A、B、Select、Start、右、左、上、下。

## 导出桌面版或移动版

```bash
dotzuki export --native . --out dist/native
dist/native/game --headless --frames 120 --screenshot native.png
```

CLI 会打印可执行文件路径。以 `.` 为项目参数时，文件名是 `game`（Windows 上为
`game.exe`）。以 `my-game` 等目录名为参数时，可执行文件使用该名称。
将可执行文件和 `game.dzpk` 一起分发。播放器打开同目录下的游戏包，并将存档写入该目录，
因此请选择可写的安装目录。播放器也支持旧的 `game.bundle.json` 格式。

请在每个待分发的桌面操作系统上构建对应版本。在引擎源码目录中，可以用 Cargo 构建本机播放器。
如果单独安装了 CLI，用 `--player-bin` 指定配套的可执行文件。桌面编辑器的
**试玩 > 导出原生** 会使用随附的播放器。移动端所需的运行库和导出步骤见
[Android 导出指南](export-android.zh-CN.md)或[鸿蒙导出指南](export-harmonyos.zh-CN.md)。

## 升级现有游戏

1. 备份 `.dotzuki-save.json`，用当前工具链运行 `dotzuki check .`。
2. 升级 CLI 或编辑器。再次校验项目，载入存档，运行一个场景并完成一场战斗。
   运行器支持格式版本 1 至 3 的存档，会拒绝更新格式的存档。
3. 使用各目标配套的播放器或运行库重新导出，分发更新后的预编译场景数据。

Rust 游戏应在 `Cargo.toml` 中一并更新各 `dotzuki-*` 依赖版本或 git 标签，然后在
游戏仓库中运行 `cargo update` 和 `cargo build`。升级自定义战斗或移动端宿主时，
请参阅[迁移指南](../release-notes/migration/v0.12.0.zh-CN.md)。
