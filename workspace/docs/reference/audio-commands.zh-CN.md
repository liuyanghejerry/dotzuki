# 音频命令参考

> 本文是 `reference/audio-commands.md` 的中文翻译，同步至引擎版本 v0.1.0（源文档 commit 3133fb419ae3bc6e5c08bbbcd43ac7fa0289e44f）。
> 内容以英文源为准；发现不一致请更新英文源再同步翻译。

> - **Audience**: game authors
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.1.0

通道命令列表中可包含的 22 个 `AudioCommand` 变体及其字段；`TrackDef` 格式与
播放调用见[音频指南](../how-to/audio.md)。

命令以内部标记形式序列化：`{"type": "<name>", ...}`。它与引擎的字节码通道
命令一一对应。权威 schema 是 `crates/dotzuki-audio/src/format.rs`。

| `type` | 字段 | 含义 |
|---|---|---|
| `note` | `pitch` 0–11 (C..B)，`length` 1–16 | 播放一个音符 |
| `drum_note` | `length` 1–16，`instrument` | 噪声通道的鼓点音符 |
| `rest` | `length` 1–16 | 静音 |
| `note_type` | `speed`，`param` | 音符速度 + 音量/包络字节（wave 通道：低半字节 = wave 乐器） |
| `octave` | `value` 0–7 | 设置八度（音乐八度 = 8 − value） |
| `toggle_perfect_pitch` | — | 切换 perfect-pitch 标志 |
| `vibrato` | `delay`，`depth_rate` (depth<<4 \| rate) | 带起始延迟的颤音 |
| `pitch_slide` | `length_modifier`，`octave_pitch` (octave<<4 \| pitch) | 开始滑音 |
| `duty_cycle` | `value` 0–3 | 方波占空比 |
| `tempo` | `value` | 设置 tempo（8.8 定点数） |
| `stereo_panning` | `value` | NR51 声像字节 |
| `unknown_ef` | `value` | 未使用的 `$EF` 命令（仅往返保留） |
| `volume` | `value` | 主音量（NR50） |
| `execute_music` | — | 切换 SFX 通道的 execute-music 标志 |
| `duty_cycle_pattern` | `value` | 占空比轮换模式（4 × 2 位） |
| `sound_call` | `offset` | 在通道流的字节偏移处调用子程序 |
| `sound_loop` | `count` (0 = infinite)，`offset` | 跳回某个偏移继续循环 |
| `sound_ret` | — | 从 `sound_call` 返回 |
| `pitch_sweep` | `param` | 通道 1 扫频（NR10）；仅 SFX |
| `sfx_square_note` | `length`，`volume_envelope`，`frequency` | 带显式包络与 11 位频率的 SFX 方波音符 |
| `sfx_noise_note` | `length`，`volume_envelope`，`noise_params` | 带显式包络的 SFX 噪声音符 |
| `end_of_data` | — | 结束标记 |
