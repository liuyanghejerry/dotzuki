# 游戏外壳参考

> 本文是 `reference/game-shell.md` 的中文翻译，同步至引擎版本 v0.5.4（源文档 commit 3133fb419ae3bc6e5c08bbbcd43ac7fa0289e44f）。
> 内容以英文源为准；发现不一致请更新英文源再同步翻译。

> - **Audience**: rust developers
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.5.4

[游戏外壳](./glossary.md)（`dotzuki_web::game_shell`，源码见
`crates/dotzuki-web/src/game_shell.rs`）以 Game Boy 帧节奏在浏览器
canvas（wasm32）或原生回退窗口中运行一个 `GameLoop` 游戏。本页是它的
API 参考：feature 开关、`GameLoop` trait、`GameShellConfig` 与
`run_game`。

## 它是什么

游戏外壳是原生专用的 `dotzuki_renderer::window::run` 的 Web 对应物：
同一套 pixels + winit 技术栈、同一个 GB 帧节奏
（4194304 Hz / 70224 cycles ≈ 59.7275 Hz），外加 wasm 游戏所需的浏览器
管线——替换宿主页面中的占位 `<canvas>`、在窗口缩放时跟随父元素宽度、
可选的 FPS 计数元素，以及由 `requestAnimationFrame` 驱动的轮询。

游戏相关的接线留在游戏 crate 中：由游戏构建 `GameShellConfig`、实现
`GameLoop`，并在宿主页面需要对运行中的游戏做运行时控制时，自己保留
一份传给 `run_game` 的 `Rc<RefCell<G>>` 克隆。

外壳的 `GameLoop` 是一个独立于原生版本的 trait，为的是让
`dotzuki-web` 保持 wasm 兼容：

| | `dotzuki_renderer::window::GameLoop` | `dotzuki_web::game_shell::GameLoop` |
|---|---|---|
| 目标平台 | 仅原生 | wasm32 + 原生回退 |
| 入口 | `run(config, game)`——同步，按值接管游戏 | `run_game(config, Rc<RefCell<G>>)`——异步 |
| 配置类型 | `GameWindowConfig` | `GameShellConfig`（多出 `canvas_id`、`fps_element_id`） |
| 手势钩子 | — | `on_user_gesture` |
| 再导出于 | `dotzuki_app::GameLoop` / `dotzuki_app::run` | `dotzuki_web` crate 根部 |

仓库内可参照的消费方模式是**原生**路径：`dotzuki-runner` 为
`RunnerGame` 实现 `dotzuki_app::GameLoop`
（`crates/dotzuki-runner/src/game.rs`），再由 `dotzuki-cli` 用
`dotzuki_app::run(...)` 启动——那是经 `dotzuki-app` 再导出的
`dotzuki_renderer::window` 路径，不是本页的游戏外壳。编辑器的
[WASM 运行器](./glossary.md)构建只启用 `modern-audio` feature，因此
`game-shell` 目前在仓库内没有消费方；它是面向游戏的 API。

## feature 开关

该模块由 `dotzuki-web` 的 `game-shell` Cargo feature 门控
（`crates/dotzuki-web/Cargo.toml:45-63`），**默认关闭**，这样编辑器的
布局预览桥就不会把 pixels / winit 拖进从不开窗口的消费方。在
`Cargo.toml` 中启用：
`dotzuki-web = { version = "0.5.4", features = ["game-shell"] }`。

该 feature 会引入 `pixels =0.15.0`、`winit 0.30`、`error-iter`、
`dotzuki-renderer/gpu`（供 `InputState::set_from_keycode` 使用），
以及若干 `web-sys` DOM 类型（`Window`、`Document`、`Element`、
`Node`、`Event`、`EventTarget`、`Performance`、`HtmlCanvasElement`、
`GpuTextureFormat`）。开启后，crate 根部平铺再导出整个 API：
`GameLoop`、`GameShellConfig`、`GameShellError`、`run_game`
（`crates/dotzuki-web/src/lib.rs:25`）。

## `GameLoop` trait

引自 `game_shell.rs:47-67`：

```rust
pub trait GameLoop {
    type Fb: FbSurface;

    fn update(&mut self, input: &InputState);
    fn draw(&mut self, fb: &mut Self::Fb);
    fn should_exit(&self) -> bool { false }
    fn on_user_gesture(&self) {}
}
```

- `type Fb: FbSurface`——游戏绘制用的帧缓冲：
  `dotzuki_renderer::FrameBuffer`（真彩色游戏）或
  `dotzuki_renderer::RgbaIndexedFrameBuffer`（固定调色板游戏）。
- `update(&mut self, input: &InputState)`——每个 GB 帧调用一次；返回前
  处理输入。
- `draw(&mut self, fb: &mut Self::Fb)`——每次重绘调用一次；把当前画面
  画进帧缓冲。
- `should_exit(&self) -> bool`——默认 `false`；返回 `true` 时循环
  退出。
- `on_user_gesture(&self)`——默认空操作；每次按键都会调用。浏览器把
  按键算作用户手势，所以这是恢复挂起状态 `AudioContext` 的钩子。

## `GameShellConfig`

引自 `game_shell.rs:70-89`：

```rust
pub struct GameShellConfig {
    pub title: String,
    pub scale: u32,
    pub resizable: bool,
    pub width: u32,
    pub height: u32,
    pub canvas_id: String,              // wasm only
    pub fps_element_id: Option<String>, // wasm only
}
```

- `width` / `height`——逻辑帧缓冲像素（如 GB 分辨率游戏为 160×144，
  GBA 分辨率为 240×160）。
- `scale`——初始窗口尺寸的整数倍率；窗口的最小内部尺寸是未缩放的
  帧缓冲尺寸。
- `canvas_id`（仅 wasm）——外壳要替换的占位 `<canvas>` 的 DOM id。
- `fps_element_id`（仅 wasm）——大约每 30 帧更新为 `"NN FPS"` 的元素
  的 DOM id；`None` 关闭计数器。

`GameShellConfig::new(title, width, height, scale)` 填入惯用默认值：
`resizable: true`、`canvas_id: "game-canvas"`、
`fps_element_id: Some("fps-counter")`——宿主页面缺少对应元素时，
这两个 DOM id 都是空操作。

## `run_game`

引自 `game_shell.rs:154-157`：

```rust
pub async fn run_game<G: GameLoop + 'static>(
    config: GameShellConfig,
    game: Rc<RefCell<G>>,
) -> Result<(), GameShellError>
```

- **原生**：运行 winit 事件循环直到结束，游戏退出后返回。
- **wasm32**：把游戏交给浏览器事件循环（`EventLoop::spawn`），随后
  立即返回。
- 该函数是异步的，因为 pixels 的 surface 创建在 wasm 上是异步的；
  原生调用方用 `pollster::block_on` 包裹它。
- 游戏放在 `Rc<RefCell<G>>` 后面共享，宿主页面可以保留一份克隆，
  在帧与帧之间通过自己导出的函数驱动运行中的游戏——这之所以成立，
  是因为 JS 是单线程的，这些调用绝不会落在 `update` / `draw` 内部。

### `GameShellError`

引自 `game_shell.rs:110-117`：

```rust
pub enum GameShellError {
    EventLoop(String),
    WindowCreation(String),
    PixelBuffer(pixels::Error),
}
```

实现 `Debug` / `Display` / `Error`；只有 `PixelBuffer` 携带
`source()`，并提供 `From<pixels::Error>` 转换。

## 运行时行为

### 帧节奏

两个目标平台都按每个 GB 帧一次 `update` 的节奏运行（≈16.7427 ms）。
每帧循环依次执行：`update` → `input.begin_frame()` → `should_exit`
检查 → `request_redraw`。

- **原生**：`FRAME_DURATION = 16_742_706 ns`，在 `AboutToWait` 中用
  `Instant` 截止时间加 `thread::sleep` 驱动
  （game_shell.rs:39、316-336）。
- **wasm32**：`FRAME_MS = 1000.0 * 70224.0 / 4194304.0`，对照
  `performance.now()` 计量，使用 `next_frame_ms` 累加器，并带死亡螺旋
  钳制——循环落后时，下一个截止点重置为 `now + FRAME_MS`，而不是连发
  补帧（game_shell.rs:42、267-315）。

### 渲染

每次 `RedrawRequested` 先向游戏的帧缓冲执行 `draw`，然后
`frame_buffer.present_into(pixels.frame_mut())`，再
`pixels.render()`。渲染与 surface 缩放错误会记录日志并退出循环
（game_shell.rs:233-248）。在 wasm 上，pixels 构建器强制
`Rgba8Unorm` 与 WebGL 后端（`Backends::GL`）：一些浏览器暴露的
WebGPU limits 不完整，会让 wasm-bindgen panic
（game_shell.rs:196-209）。

### 输入

`KeyCode` 事件喂给 `InputState::set_from_keycode`。`Escape` 在两个
目标平台上都会退出，没有关闭选项。任何按键都会先触发
`on_user_gesture`，再进入输入处理（game_shell.rs:249-263）。

### canvas 管线（wasm32）

`install_canvas` 设置 winit canvas 的 id，并**替换**宿主页面中带
`config.canvas_id` 的占位元素；元素缺失时以
`couldn't find placeholder canvas element` panic
（game_shell.rs:382-397）。窗口缩放监听器会把 surface 重新适配到父
元素宽度，并钳制在视口与倍率帧缓冲宽度以内，保持帧缓冲宽高比
（game_shell.rs:362-377、399-418）。

## 示例

一个最小游戏：按住 `Right` 时，一个 8×8 白色方块在 160×144 屏幕上
向右移动。示例给出原生入口；在 wasm32 上调用 `run_game` 时不要套
`pollster::block_on`，若宿主页面需要驱动游戏，则保留一份
`Rc<RefCell<TinyGame>>` 克隆。

<!-- not verified -->
```rust
use std::cell::RefCell;
use std::rc::Rc;

use dotzuki_renderer::input::{GbButton, InputState};
use dotzuki_renderer::{FbSurface, FrameBuffer, Rgba};
use dotzuki_web::game_shell::{run_game, GameLoop, GameShellConfig, GameShellError};

struct TinyGame {
    block_x: u32,
}

impl GameLoop for TinyGame {
    type Fb = FrameBuffer;

    fn update(&mut self, input: &InputState) {
        if input.is_held(GbButton::Right) {
            self.block_x = (self.block_x + 1) % 160;
        }
    }

    fn draw(&mut self, fb: &mut Self::Fb) {
        fb.fill_rect(0, 0, 160, 144, Rgba::BLACK);
        fb.fill_rect(self.block_x, 64, 8, 8, Rgba::WHITE);
    }
}

fn main() -> Result<(), GameShellError> {
    let config = GameShellConfig::new("Tiny Game", 160, 144, 4);
    let game = Rc::new(RefCell::new(TinyGame { block_x: 0 }));
    pollster::block_on(run_game(config, game))
}
```

## 注意事项

- **`Escape` 总是退出。** 两个目标平台都会在 Escape 上终止循环；游戏
  无法重映射或禁用它。
- **占位 canvas 缺失会 panic（wasm32）。** `install_canvas` 要求宿主
  页面存在 id 为 `canvas_id` 的元素，否则 panic——页面里请放上
  `<canvas id="game-canvas">`（或你配置的 id）。
- **`ControlFlow::Poll` 必不可少。** 循环设置 `ControlFlow::Poll` +
  `EventLoop::spawn`；没有 `Poll`，winit 0.30 的 Web 后端只在事件到达
  时运转（约 5 FPS）（game_shell.rs:159-160）。
- **wasm 上强制 WebGL。** 外壳固定 `Backends::GL` 与 `Rgba8Unorm`；
  一些浏览器返回不完整的 WebGPU limits 对象会让 wasm-bindgen panic，
  因此 WebGPU 在这里不可选。
- **窗口代码没有单元测试。** 该模块通过消费方验证；上面的示例是骨架，
  不是经过测试的程序。
