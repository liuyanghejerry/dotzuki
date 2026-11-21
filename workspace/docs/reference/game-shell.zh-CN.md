# 游戏外壳参考

> 本文是 `reference/game-shell.md` 的中文翻译，同步至引擎版本 v0.12.0
>（源文档 commit 3030dd484e28cfd7c128e8451e72b73d36913006）。
> 内容以英文源为准；发现不一致请更新英文源再同步翻译。

> - **Audience**: rust developers
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.12.0

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
可选的 FPS 计数元素，以及由 `requestAnimationFrame` 驱动的呈现。

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
`dotzuki-web = { version = "0.10.1", features = ["game-shell"] }`。

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
    fn pointer_click(&mut self, _x: f32, _y: f32) {}
    fn cancel_pointer_input(&mut self) {}
    fn draw(&mut self, fb: &mut Self::Fb);
    fn should_exit(&self) -> bool { false }
    fn on_user_gesture(&self) {}
}
```

- `type Fb: FbSurface`——游戏绘制用的帧缓冲：
  `dotzuki_renderer::FrameBuffer`（真彩色游戏）、
  `dotzuki_renderer::RgbaIndexedFrameBuffer`（packed 固定调色板存储）或
  `dotzuki_renderer::LinearRgbaIndexedFrameBuffer`（字节索引、word 对齐）。
  应用显式选择格式，三种存储在所有目标平台保持相同含义，均实现
  `FbSurface`。
- `update(&mut self, input: &InputState)`——每个 GB 帧调用一次；返回前
  处理输入。
- `draw(&mut self, fb: &mut Self::Fb)`——每次重绘调用一次；把当前画面
  画进帧缓冲。
- `should_exit(&self) -> bool`——默认 `false`；返回 `true` 时循环
  退出。
- `pointer_click` 接收鼠标主键或触摸的帧缓冲坐标；`cancel_pointer_input` 在失焦或
  触摸取消时丢弃待处理操作。两者默认空操作，游戏决定是否开启点击导航。
- `on_user_gesture(&self)`——默认空操作；键盘、鼠标或触摸按下时调用，
  用于恢复挂起的 `AudioContext`。

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
- `fps_element_id`（仅 wasm）——每完成 30 次渲染更新为 `"NN FPS"` 的元素
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

模拟以每秒约 59.7275 次更新推进，与显示器刷新率无关。
每次更新消费一个 `BufferedInput::next_frame()` 快照，并检查 `should_exit`。

- **原生**：`AboutToWait` 使用 `Instant` 截止时间和 `ControlFlow::WaitUntil`；
  等待不会阻塞已排队的输入或重绘事件。
- **wasm32**：`ControlFlow::Wait` 在浏览器绘制之间让出执行。
  `AboutToWait` 请求下一次重绘，`RedrawRequested` 读取 `performance.now()` 并推进固定时钟。
  短延迟最多补五帧；更长暂停丢弃积压并从一帧恢复，避免后台标签重放数秒的按键。
  尚未到更新时刻的绘制请求跳过模拟与渲染。

### 渲染

完成到期更新后，外壳依次调用 `draw`、`frame_buffer.present_into(pixels.frame_mut())`
和 `pixels.render()`。游戏不得在 `draw` 中推进玩法，低刷新率显示器可能一次呈现多个
模拟帧。可选 FPS 元素统计完成的渲染次数，不统计模拟帧数。
渲染和 surface 缩放错误会记录日志并退出循环。在 wasm 上，pixels 构建器强制
`Rgba8Unorm` 和 WebGL（`Backends::GL`），因为部分浏览器暴露的 WebGPU limits 不完整。

### 零 Rust 运行器的帧缓冲复用

原生播放器、编辑器 Play 和移动端运行器会保留上一帧的 RGBA 帧缓冲。
`RunnerGame::draw_retained` 更新该缓冲，并返回以屏幕像素为单位的变化区域
`DirtyRegion`。首帧覆盖整个视口。大地图、对话、暂停菜单、背包、队伍、商店或战斗菜单静止时，
变化区域为空。镜头固定时，角色和目的地标记只重绘新旧位置，包含与之相交的 NPC 和上层图块。
移动列表光标会恢复原位置的像素并绘制新光标。提示框遮住长列表时，移动光标会重绘面板。

普通滚屏会平移已有像素，补画露出的地图边缘，再更新移动的角色和标记。地图在屏幕上的位置
发生了变化，因此返回整个视口作为显示区域。海拔变化、地图重新加载和淡入淡出也会触发完整更新。
宿主可以调用 `RunnerGame::draw` 填充替换后的输出缓冲。

编辑器 Play 和 Web 导出每推进一个游戏帧就调用 `runner.advance(input)`，再用
`runner.present(ctx, false)` 将累计的变化绘到保留内容的 Canvas。传入 `true` 可以刷新替换后的
画布。Android 和 HarmonyOS 导出外壳通过移动 ABI 读取按行紧密排列的 RGBA 矩形。
需要完整快照的宿主可使用 Web 的 `tick` 或移动端的 `copy_frame`。

### 运行器音频与性能基线

移动端将立体声 f32 输出缓冲传给 `RunnerGame::render_audio_into`。返回值是两个声道的
采样值总数。首条音轨开始前，运行器向缓冲区写入静音并返回零。Web 宿主通过
`RunnerGame::append_audio` 在可复用的队列中累计多个游戏帧的采样。

CI 的 `runner-performance` 任务用 Callgrind 统计地图静止、地图滚动、背包导航、
战斗菜单导航、PCM 渲染和携带 2,048 个存档 flag 的剧情激活所执行的指令数。
每个场景在 `ci/runner-performance/baseline.json` 中有独立的基线。任何一项超过
对应基线 10% 都会使任务失败。创建测试项目和预热期间的指令不计入结果。

复现 CI 基线使用 x86-64 Ubuntu 24.04、Valgrind 3.22.0 和 Rust 1.89.0。从 `workspace/` 运行
`python3 scripts/runner-performance.py --output counts.json`。输出文件和 CI 上传的
产物使用相同的基线格式。更新基线时应同时审查相应的工作负载或编译器变更。

### 索引帧缓冲上的对话文字

`dotzuki_renderer::embedded_font::draw_text` 和 `draw_text_scaled` 绘制一个字符串时，
只用基础调色板匹配一次文字颜色。平面打包和线性存储的索引帧缓冲都直接写入这个索引。
可用字形包括完整 Fusion Pixel 字库里的拉丁字母和中日韩字符，以及两个光标箭头（▶ 和 ▼）。
淡入淡出或重映射调色板时，新画的对话和屏幕上已有的文字会呈现相同的效果。

### 四色战斗转场快照

`dotzuki_renderer::battle_transition::CompactTransitionSnapshot::capture` 从
`LinearRgbaIndexedFrameBuffer<GbColor>` 捕获当前显示调色板和像素索引，每字节保存四个
索引。160 × 144 画面的像素占用 5,760 字节。`render` 把 `BattleTransitionState`
绘制到线性帧缓冲，并使用目标当前的调色板。`restore` 同时还原捕获的调色板。两者都
支持尺寸不同的源和目标，还原源像素时会裁剪到两者共有的区域。

### 输入

键盘事件进入 `BufferedInput`；两个更新之间的快速按下／松开仍保留到一次更新。
失焦丢弃按住状态和待处理短按。`Escape` 退出原生窗口；浏览器不映射该键，循环继续运行。
Q/E 对应 L/R；方向键、WASD、Z/X、Enter/Space、Backspace/Right Shift 保留既有映射。

`GbButton::bit_mask`、`InputState::raw_current`、`raw_previous`、`pressed_mask` 和
`set_from_bitmask` 使用 `u16`。位 0–7 仍为 A、B、Select、Start、Right、Left、Up、Down；
位 8–9 为 R、L。`from_explicit_channels(current, previous, pressed)` 提供独立按下边沿，
不改变按住状态。`begin_frame` 或物理输入修改恢复 `current & !previous` 的边沿推导。
运行器既有 8 位 Web／移动入口对输入补零扩展，保持 ABI。

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

- **`Escape` 退出原生窗口。** 浏览器不映射该键，不会因该键停掉循环并冻结最后一帧。
- **占位 canvas 缺失会 panic（wasm32）。** `install_canvas` 要求宿主
  页面存在 id 为 `canvas_id` 的元素，否则 panic——页面里请放上
  `<canvas id="game-canvas">`（或你配置的 id）。
- **保持重绘请求。** 浏览器节奏依赖 `AboutToWait` 请求下一次重绘，绘制之间使用
  `ControlFlow::Wait`。
- **wasm 上强制 WebGL。** 外壳固定 `Backends::GL` 与 `Rgba8Unorm`；
  一些浏览器返回不完整的 WebGPU limits 对象会让 wasm-bindgen panic，
  因此 WebGPU 在这里不可选。
- **同时验证时钟与宿主集成。** 单元测试覆盖 30–240 Hz 显示、延迟绘制、后台暂停、
  短按缓冲和按键通道。消费方仍需原生与浏览器冒烟测试；上方示例仍是未验证骨架。
