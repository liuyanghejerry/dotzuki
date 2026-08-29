# 音频运行时参考

> 本文是 `reference/audio-runtime.md` 的中文翻译，同步至引擎版本 v0.5.4（源文档 commit 3133fb419ae3bc6e5c08bbbcd43ac7fa0289e44f）。
> 内容以英文源为准；发现不一致请更新英文源再同步翻译。

> - **Audience**: rust developers
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.5.4

`dotzuki-audio` 的 Rust 运行时 API：逐 VBlank 的 `AudioManager` 编排器，
以及设备输出层（`SampleSource` / `CpalOutput` / `WebAudioOutput`）。

制作侧——[音轨](./glossary.md) JSON 文件与场景播放调用——见
[音频制作指南](../how-to/audio.md)，22 条通道命令见
[音频命令参考](./audio-commands.md)。本页讲播放这些音轨的代码：
`crates/dotzuki-audio/src/manager.rs` 与 `crates/dotzuki-audio/src/output/`。

## AudioManager

`AudioManager<M, S>` 掌管[音序器](./glossary.md) + [GB-APU](./glossary.md)
之上每个 VBlank（约 60 Hz）发生的一切：NR50 主音量盖印、音乐淡出状态机、
跨曲目断点续播快照，以及带音高/速度修饰的 SFX/叫声播放。id 类型是泛型的
——`M: Copy + Eq + Hash + 'static`（音乐），`S: Copy + 'static`（SFX）。
逐采样推进 APU 属于输出层，不属于管理器。

### 构造与曲目表

游戏在构造时交出两张曲目表，形式是两个 `fn` 指针——不能是捕获环境的闭包
——`AudioManager::new(music_track, sfx_track)`，签名分别为
`fn(M) -> TrackData` 与 `fn(S) -> TrackData`。

| `TrackData` 字段 | 类型 | 含义 |
|---|---|---|
| `sound_id` | `u8` | 交给音序器通道状态的引擎音效 id |
| `channels` | `[Option<&'static [u8]>; 4]` | 按硬件顺序（pulse1、pulse2、wave、noise）排列的通道字节流；`None` 槽位表示未使用 |
| `tempo` | `u16` | 16 位定点初始速度；普通 SFX 忽略此项（按 `0x0100` 播放，叫声按 `0x0080` + 修饰值） |

字段 `sequencer`、`apu`、`fade_state`、`fade_counter_reload` 和
`fade_queued_music` 均为 pub，供引擎层集成使用。

**APU 初始是未上电的。** 必须有人——输出层或游戏——先写 NR52
（`0xFF26 = 0x80`）才能出声；向未上电的 APU 写寄存器会被忽略。

### 逐帧驱动

每个 VBlank 调用一次 `update_frame()`。其顺序是固定的：

1. `process_fade`——推进淡出状态机；
2. `apply_master_volume`——把逻辑左右音量盖印到 NR50；
3. `sequencer.update_frame(&mut apu)`——推进声音引擎；
4. 运行 post-frame hook（如果安装了的话）。

NR50 在 tick *之前*盖印，这样流内的 `volume` 命令可以在该帧剩余时间里覆
盖 NR50；淡出机制在下一帧重新接管 NR50。post-frame hook 在 tick *之后*
运行，因此在那里直接写寄存器（例如把警报音直接戳进 NR11–NR14）会覆盖声
音引擎在该帧产生的结果。

### 主音量

| 方法 | 效果 |
|---|---|
| `master_volume_left()` / `master_volume_right()` | 逻辑两侧音量，各 0–7 |
| `set_master_volume(l, r)` | 两侧钳制到 `0..=7`，立即写 NR50 |
| `nr50()` | 最近一次盖印到 APU 的 NR50 字节 |

### 淡出状态机

`FadeState` 取 `None` 或 `FadingOut`（`fade_state()`、`is_fading()`）。

- `play_music_with_fade(id, fade_speed)`——`id` 是当前曲目时是空操作；没
  有音乐在播时立即开始；否则开始淡出并把 `id` 排入淡出后的队列。
- `fade_out(fade_speed)`——淡出到静音，然后停止。
- `fade_out_then_play(id, fade_speed, on_restart)`——`on_restart` 钩子
  （`FnOnce(&mut Sequencer) + Send`）在排队曲目启动后、下一次 tick 前运
  行。

倒数器住在 `Sequencer::fade_counter`：每帧递减；到零时从
`fade_counter_reload` 重装，同时两侧音量各降一档（`saturating_sub`）。两
侧都到 0 时淡出完成：音序器停止一切，排队曲目经 `play_music` 启动，被取
出的淡出完成钩子运行。`fade_speed = 0` 表示每帧降一档——从满音量起共 7
档加 1 帧完成帧。

没有淡出在跑时，主音量每帧都会重新盖印——除非设置了
`set_no_audio_fade_out(true)`，它让流内 `volume` 写入保持生效（用
`no_audio_fade_out()` 读回）。

### 断点续播快照

切到不同曲目时，`play_music(id)` 会把当前音序器克隆进
`saved_music_states`、以旧 id 为键；再次请求有快照的曲目时经
`Sequencer::restore_music_from` 续播，而不是重新开始。`stop_music()` 与
`stop_all()` 丢弃全部快照；`clear_saved_music_states()` 只丢弃快照、不动
播放（地图切换场景）；`discard_saved_music_state(id)` 让某条曲目下次重新
开始。`last_music_id()` 返回当前曲目。

### SFX 与叫声

- `play_sfx(id)`——等价于 `play_sfx_with_modifiers(id, 0, 0x0100)`。
- `play_sfx_with_modifiers(id, frequency_mod, tempo)`——把
  `frequency_mod` 装到 `Sequencer::frequency_modifier`（加到每个音符的频
  率上），并把 `tempo` 作为本次播放的 SFX 速度：这就是叫声路径。
- `sfx_start_channel(id) -> Option<usize>`——该 SFX 用到的第一个硬件通
  道，供游戏按通道门控 SFX。

`stop_sfx()` 停止 SFX 侧；`stop_all()` 停止音乐与 SFX、结束任何淡出并丢
弃续播快照。查询：`is_music_playing()`、`is_sfx_playing()`。

### 钩子

`set_post_frame_hook(Some(Box::new(...)))` 安装一个
`FnMut(&mut Apu, &mut Sequencer) + Send` 闭包，在每次 `update_frame` 末
尾运行；传 `None` 则移除。两类钩子都带 `Send` 约束，使管理器可以跨线程
移动——输出层在自己的回调线程上拉取采样。

### 示例

```rust
use dotzuki_audio::manager::{AudioManager, FadeState, TrackData};

static THEME_A_CH1: &[u8] = &[0xDC, 0xC7, 0xE5, 0x04, 0xFF];
static THEME_B_CH1: &[u8] = &[0xDC, 0xC7, 0xE5, 0x14, 0xFF];

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum Music { ThemeA, ThemeB }
#[derive(Clone, Copy)]
enum Sfx { Beep }

fn music_track(id: Music) -> TrackData {
    match id {
        Music::ThemeA => TrackData {
            sound_id: 1,
            channels: [Some(THEME_A_CH1), None, None, None],
            tempo: 0x0070,
        },
        Music::ThemeB => TrackData {
            sound_id: 2,
            channels: [Some(THEME_B_CH1), None, None, None],
            tempo: 0x0090,
        },
    }
}

fn sfx_track(_id: Sfx) -> TrackData {
    TrackData { sound_id: 0x40, channels: [None, None, None, None], tempo: 0 }
}

let mut mgr = AudioManager::new(music_track, sfx_track);
mgr.apu.write_register(0xFF26, 0x80); // NR52 power on — silent without it
mgr.set_master_volume(15, 3);         // clamps to (7, 3); NR50 reads 0x73
assert_eq!(mgr.nr50(), 0x73);

mgr.play_music(Music::ThemeA);        // resets volume to full
mgr.play_music_with_fade(Music::ThemeB, 0); // fade speed 0: one step per frame
while mgr.is_fading() {
    mgr.update_frame(); // once per VBlank: fade → NR50 → sequencer tick
}
assert_eq!(mgr.last_music_id(), Some(Music::ThemeB));
assert_eq!(mgr.fade_state(), FadeState::None);
```

*Verified by `fade_steps_volume_down_then_switches_music` and
`set_master_volume_clamps_and_writes_nr50` in
`crates/dotzuki-audio/src/manager.rs`.*

## 输出层

输出层是仿真 APU 与真实音频后端之间的拉取式（pull-model）胶水。采样源按
设备采样率渲染交错立体声 `f32`；后端的回调线程每个采样把 APU 推进
`CPU_CLOCK_HZ / sample_rate` 个周期并经由 `Apu::mix_sample` 混音，而游戏
线程只推进音序器，每个视频帧一次。

| Feature | 条目 | 平台 | 默认 |
|---|---|---|---|
| `cpal` | `CpalOutput` | 原生 | 关闭 |
| `web-audio` | `WebAudioOutput` | 仅 wasm32 | 关闭 |
| — | `SampleSource`、`render_apu_stereo` | 全部 | 始终编译 |

常量：`OUTPUT_SAMPLE_RATE = 44_100`；`MAX_AMPLITUDE = 480.0`，用于把
`mix_sample` 的 `i16` 输出归一化到 `[-1.0, 1.0]` 的 APU 峰值；crate 级常
量 `CPU_CLOCK_HZ = 4_194_304` 与 `SAMPLE_RATE = 44_100`。

### SampleSource 与 render_apu_stereo

```rust
pub trait SampleSource: Send + 'static {
    fn render(&mut self, out: &mut [f32], sample_rate: u32);
}
```

*Verified by `closure_is_a_sample_source` in
`crates/dotzuki-audio/src/output/mod.rs`.*

blanket impl 覆盖了任何 `FnMut(&mut [f32], u32) + Send + 'static` 闭
包，因此前端可以捕获持有 APU 的共享 `Arc<Mutex<…>>`，在回调线程上渲染。
`render_apu_stereo(apu, out, sample_rate)` 是每个后端共用的同一条采样路
径，所以所有前端渲染出字节一致的音频：

```rust
use dotzuki_audio::apu::Apu;
use dotzuki_audio::output::{render_apu_stereo, SampleSource, OUTPUT_SAMPLE_RATE};

let mut apu = Apu::new();
let mut source = move |out: &mut [f32], rate: u32| {
    render_apu_stereo(&mut apu, out, rate);
};
let mut buf = vec![1.0; 16];
SampleSource::render(&mut source, &mut buf, OUTPUT_SAMPLE_RATE);
assert!(buf.iter().all(|&s| s == 0.0)); // a powered-off APU mixes silence
```

*Verified by `closure_is_a_sample_source` and
`render_apu_stereo_fills_interleaved_frames` in
`crates/dotzuki-audio/src/output/mod.rs`.*

### CpalOutput（feature `cpal`，原生）

`CpalOutput::new(source) -> Option<CpalOutput>` 打开默认 host 的默认输出
设备（立体声 44.1 kHz），并在 cpal 的回调线程上开始从采样源拉取。返回
`None` 表示没有输出设备（CI、无头环境）或流构建失败——调用方继续保持
静默。drop 该输出即停止流。

### WebAudioOutput（feature `web-audio`，仅 wasm32）

`WebAudioOutput::new(source) -> Option<WebAudioOutput>` 请求一个 44.1 kHz
的 `AudioContext`（失败则退回设备默认采样率），并把一个
`ScriptProcessorNode`——缓冲区 2048（约 46 ms）、0 输入、2 输出——接到
destination。`sample_rate()` 返回协商后的采样率：浏览器可能不理会 44.1
kHz 请求，而每次渲染传给采样源的正是协商值。浏览器把音频门控在用户手势
之后，因此在播放命令前调用 `try_resume()`。

## 消费模式

### 原生：共享引擎上的闭包

`dotzuki-runner` 启用 `dotzuki-audio` 的 `["serde", "cpal"]` feature。它
的 `render_into`（`crates/dotzuki-runner/src/audio.rs`）调用
`render_apu_stereo`——启用时再加上现代混音器——是 cpal 回调与 PCM
`render_samples` 共用的同一条路径：

<!-- not verified -->
```rust
use dotzuki_audio::output::CpalOutput;

let output = CpalOutput::new(move |data: &mut [f32], _rate: u32| {
    let mut engine = shared_engine.lock().unwrap();
    render_into(&mut engine, data); // render_apu_stereo + optional mixer
});
// output == None → no device: keep the game running silent.
```

### WASM：每个视频帧拉取 PCM

WASM 运行器（`dotzuki-runner-web`）不使用 `WebAudioOutput`：在 wasm32 上
cpal 的 Null host 没有真实输出，也就没有回调线程驱动 APU。取而代之的是运
行器的 `tick` 每个视频帧渲染一帧份的 PCM——经小数累加器得到
`44_100 / 59.7275 ≈ 738.4` 个立体声帧——通过 `render_samples`，宿主再用
`take_audio` 把缓冲取走送入 WebAudio 队列。

### NR50 顺序：两种帧循环，两种赢家

`AudioManager::update_frame` 在音序器 tick *之前*盖印 NR50，因此流内
`volume` 命令能在该帧剩余时间里覆盖 NR50。运行器自己的
`update_engine_frame` 在 tick *之后*盖印 NR50，因此它的淡出能压过流内写
入。当曲目带 `volume` 命令时，按你希望谁赢来选择顺序。

## 注意事项

- 新建的 `AudioManager` 在写入 NR52（`0xFF26 = 0x80`）之前一直保持静默。
- 曲目表是 `fn` 指针而非闭包；共享状态必须放在 id 类型背后或静态量里。
- `CpalOutput::new` 在没有输出设备的机器上返回 `None`——继续静默运行，
  不要 panic。
- 钩子在游戏线程上以帧率运行；保持简短。
