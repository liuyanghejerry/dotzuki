# 大地图表现动画

> 本文是 `reference/overworld-presentation.md` 的中文翻译，同步至引擎版本 v0.5.4（源文档 commit 3133fb419ae3bc6e5c08bbbcd43ac7fa0289e44f）。
> 内容以英文源为准；发现不一致请更新英文源再同步翻译。

> - **Audience**: rust developers
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.5.4

`dotzuki_engine::overworld::presentation` 的逐帧计数的动画
状态机——传送旋转、电梯震动、水面/花朵 tile、钓鱼、推石
扬尘、调色板闪白与离港演出——附各自动画时长、相位与访问
器契约。

该模块（`crates/dotzuki-engine/src/overworld/presentation.rs`）
把经典 JRPG 在[大地图](./glossary.md)（overworld）上以阻塞方式播放的视觉
效果复刻为纯逻辑、游戏无关的状态机。它不在
`dotzuki_engine::overworld` 处重导出；消费方使用完整模块
路径。除模块自身的单元测试外，仓库内没有消费方；它是面向
游戏的 API。

## 逐帧驱动模型

这里的每个状态机都遵循同一份契约：

- 游戏在效果开始时构造状态，每帧调用一次 `tick()`（期间
  冻结 gameplay），渲染器每帧通过访问器读取状态。
  （`TileAnimState` 是例外：它在正常游玩期间于后台循环。）
- 所有时长都是帧数，绝不是秒。以固定速率 tick。
- 音效提示是类型化枚举（`TeleportSpinSfx`、
  `EnterMapSpinSfx`、`ElevatorShakeSfx`、`ShipDepartureSfx`），
  由 `tick()` 返回；游戏把它们映射到自己的音频 id。
- 状态仅依赖 `Direction`
  （`crates/dotzuki-engine/src/overworld/types.rs`）、注入的
  调校数据与帧计数器。所有状态都派生 `Debug`/`Clone`/`Copy`。

## 传送旋转离场：`TeleportSpinState`

离开地图的动画（传送 / 逃脱道具）。相位：
`TeleportSpinPhase::{SpinInPlace, SpinUp, Delay, Done}`。

| 常量 | 值 | 含义 |
|---|---|---|
| `SPIN_IN_PLACE_FRAMES` | 136 | 16 次原地旋转，间隔 16,15,…,1 |
| `SPIN_UP_STEP_DELAY` | 3 | 上升步之间的帧数 |
| `SPIN_UP_STEPS` | 5 | 16px 的上升步数 |
| `SPIN_UP_STEP_PIXELS` | 16 | 每步上升的像素数 |
| `SPIN_POST_DELAY_FRAMES` | 10 | 上升后的收尾延迟 |

`TeleportSpinState::new(current_facing, spin_order)` 接收旋转
经过的朝向循环（经典顺序为 `[Down, Left, Up, Right]`）；
若 `current_facing` 不在循环中，则回退到下标 0。旋转先展示
`current_facing`，再沿循环推进。

`tick() -> Option<TeleportSpinSfx>` 在每次间隔为 4 的倍数的
旋转开始时返回 `SpinLoop`（第 0、4、8、12 次——共播放 4
次），并在上升阶段开始处（第 136 帧）返回一次 `Rise`。
访问器：`phase()`、`is_done()`、`facing()`、
`player_y_offset()`（≤ 0；`SpinUp` 期间精灵升出屏幕，结束时
为 −80）、`player_visible()`（精灵完全升到可视区域之上后为
false）。

总时长：136 + 17 + 10 = 163 帧。当 `is_done()` 变为 true
时，调用方开始该[传送点](./glossary.md)（warp）的淡出。

## 到达旋进入场：`EnterMapSpinState`

`TeleportSpinState` 的对应物：在传送类 warp 到达后，玩家从
屏幕上方之外下降，然后原地旋转。相位：
`EnterMapSpinPhase::{SpinDown, SpinInPlace, Done}`。

| 常量 | 值 | 含义 |
|---|---|---|
| `ENTER_MAP_SPIN_DOWN_STEPS` | 5 | 16px 的下降步数 |
| `ENTER_MAP_SPIN_DOWN_STEP_DELAY` | 3 | 下降步之间的帧数 |
| `ENTER_MAP_SPIN_DOWN_FRAMES` | 17 | 下降阶段总帧数 |
| `ENTER_MAP_SPIN_DOWN_STEP_PIXELS` | 16 | 每步下降的像素数 |
| `ENTER_MAP_SPIN_IN_PLACE_FRAMES` | 36 | 8 次原地旋转，间隔 0,1,…,7（静音） |

`EnterMapSpinState::new(current_facing, spin_order, spin_in_place)`
——到达点为传送踏板或洞口时传 `spin_in_place: false`，跳过
最后的原地旋转，恰好 17 帧结束。

该状态初始隐藏，`player_y_offset() == -80`：游戏在 warp 生效
时构造它，并在淡入完成后开始 tick（引擎不负责驱动淡入）。
`tick() -> Option<EnterMapSpinSfx>` 在第一帧返回 `Descend`，
在下降完成时返回 `Land`。访问器：`phase()`、`is_done()`、
`facing()`、`player_y_offset()`、`player_visible()`。
`is_done()` 后，调用方恢复保存的朝向与 Y 坐标。

## 电梯震动：`ElevatorShakeState`

`ElevatorShakeParams { iterations: u8, pixel_offset: u8 }` 调校
震动；`total_frames()` 为 `iterations * 2`。
`ElevatorShakeState::new(params)` 让背景按 `offset_y()` 滚动，
每个 2 帧的迭代在 −`pixel_offset` / +`pixel_offset` 间交替
（首个迭代为负方向），结束后返回 0。

`tick() -> Option<ElevatorShakeSfx>` 在每次迭代开始处返回
`Rattle`，在最后一帧返回 `Arrive`。

## 水面/花朵 tile：`TileAnimState`

循环播放的背景 tile 动画（水面旋转 / 花朵帧）。
`set_tileset(TileAnimKind)` 采用 tileset 的动画种类——
`TileAnimKind::{None, Water, WaterFlower}`——并重置逐帧计数器，
仅此而已：水面更新计数器与累积的水面位移会跨地图加载保留，
与经典 WRAM 行为一致。种类为 `None` 时 `tick()` 是空操作。

时序：逐帧计数器每帧自增；到 20 时水面 tile 旋转 1 像素；到
21 时（仅 `WaterFlower`）花朵 tile 推进且计数器归零。纯水面
tileset 在水面更新后立即归零，因此水面周期为 20 帧，带花朵
时为 21 帧。

水面更新计数器每次水面更新自增，并掩码到 0..=7；其 bit 2
决定旋转方向——该位为 0（计数值 1,2,3,0）时向右，为 1
（4,5,6,7）时向左——8 次更新的净位移依次为
1,2,3,2,1,0,−1,0。花朵帧取自计数器低两位：0/1 → 帧 1，
2 → 帧 2，3 → 帧 3。

访问器：`water_shift() -> i8`（正值 = 向右；渲染器按
`(x - shift) mod 8` 采样源列）、`flower_frame() -> Option<u8>`
（首次花朵更新前为 `None`，此时显示 tileset 的原始花朵
tile）、`kind()`。

## 钓鱼竿：`FishingAnimState`

相位：`FishingAnimPhase::{CastDelay, RodOut, Shake, Bubble,
Done}`。

| 常量 | 值 | 含义 |
|---|---|---|
| `FISHING_CAST_DELAY_FRAMES` | 10 | 钓竿出现前的停顿 |
| `FISHING_ROD_OUT_FRAMES` | 100 | 钓竿在外等待咬钩 |
| `FISHING_SHAKE_ITERATIONS` | 10 | 咬钩时的抖动次数 |
| `FISHING_SHAKE_STEP_FRAMES` | 3 | 每次抖动的帧数 |
| `FISHING_BUBBLE_FRAMES` | 60 | “!” 气泡时长 |
| `FISHING_ANIM_FRAMES` | 200 | 总时长：10 + 100 + 30 + 60 |

`FishingAnimState::new(facing, bite)` 把咬钩判定作为构造参数
——由游戏预先决定结果。无咬钩时动画在 `RodOut` 之后立即
结束，即第 110 帧；有咬钩时追加 `Shake` 与 `Bubble`。

访问器：`phase()`、`is_done()`、`facing()`、`pose_active()`
（在 `RodOut`/`Shake`/`Bubble` 期间为 true）、`rod_visible()`
（`CastDelay` 期间为 false；朝向为 `Up` 时在 `Bubble` 期间
也为 false，避免钓竿与气泡重叠）、`bubble_active()`、
`player_shake_offset()`（`Shake` 期间每 3 帧的迭代在 1/0 间
切换）。`is_done()` 后，调用方把结果文本入队。

`FishingAnimState::rod_piece(facing) -> (dx, dy, tile, x_flip)`
给出钓竿的 OAM 部件，坐标是相对玩家精灵左上角的偏移；
图集 tile 0 对应 Down/Up，tile 1 对应 Left/Right（Right 时
X 翻转）：

| 朝向 | `(dx, dy, tile, x_flip)` |
|---|---|
| `Down` | `(20, 35, 0, false)` |
| `Up` | `(20, -12, 0, false)` |
| `Left` | `(0, 16, 1, false)` |
| `Right` | `(48, 16, 1, true)` |

## 推石扬尘：`BoulderDustState`

推动的巨石滑动一格时扬起的 2×2 烟尘块：8 步
（`BOULDER_DUST_STEPS`）× 3 帧（`BOULDER_DUST_STEP_FRAMES`），
共 24 帧。`BoulderDustState::new(facing, anchor_x, anchor_y)`
把烟尘锚定在推动瞬间玩家所在的地图 tile；此后锚点不再跟随
玩家。`BoulderDustState::inactive()` 是永久结束的状态，表示
“没有烟尘”；动画结束后 `tick()` 是空操作。该状态派生了
`PartialEq`/`Eq`。

访问器：`is_active()`、`facing()`、`anchor()`、`step()`
（0..=7）、`base_offset()`（烟块左上角相对玩家精灵左上角的
偏移）、`drift_px()`（每步逆推动方向漂移 1px——巨石滑走后
烟尘留在原地）、`tile_drifts() -> [(i32, i32); 4]`（上左、
上右、下左、下右四块 8×8 tile 的每步像素位移；水平推动时
上左 tile 保持不动）、`palette_flipped()`（奇数步为 true，
让烟雾精灵的两个灰阶交替闪烁）。

| 朝向 | `base_offset()` | `drift_px()` |
|---|---|---|
| `Down` | `(8, 52)` | `(0, -1)` |
| `Up` | `(8, -12)` | `(0, 1)` |
| `Left` | `(-24, 20)` | `(1, 0)` |
| `Right` | `(40, 20)` | `(-1, 0)` |

## 调色板闪白：`FLASH_WHITE_FRAMES`

`pub const FLASH_WHITE_FRAMES: u8 = 3`——黑暗区域被点亮时
全部调色板闪白的帧数。这里没有调色板状态机；游戏自行数
这几帧。

## 离港演出：`ShipDepartureState`

离港过场。相位：`ShipDeparturePhase::{InitialPause,
WaterFill, Scroll, Erase, Done}`；用
`ShipDepartureState::new()` / `Default` 构造。

| 常量 | 值 | 含义 |
|---|---|---|
| `SHIP_DEPARTURE_INITIAL_PAUSE_FRAMES` | 120 | 音乐响起时船停在码头 |
| `SHIP_DEPARTURE_WATER_FILL_FRAMES` | 3 | 水面填充提交 |
| `SHIP_DEPARTURE_SCROLL_ITERATIONS` | 8 | 卷屏迭代次数 |
| `SHIP_DEPARTURE_ITERATION_FRAMES` | 128 | 每次迭代的帧数（16 子步 × 8 帧） |
| `SHIP_DEPARTURE_ERASE_FRAMES` | 120 | 抹除后的收尾停顿 |
| `SHIP_DEPARTURE_TOTAL_FRAMES` | 1267 | 整场过场 |
| `SHIP_DEPARTURE_SCROLL_PX_PER_ITERATION` | 16 | 每次迭代的卷屏像素 |
| `SHIP_DEPARTURE_SUBSTEPS_PER_ITERATION` | 16 | 每次迭代的烟雾漂移子步数 |
| `SHIP_DEPARTURE_SUBSTEP_FRAMES` | 8 | 每子步的帧数 |
| `SHIP_DEPARTURE_PUFF_SPACING_PX` | 16 | 烟雾团生成间距 |
| `SHIP_DEPARTURE_PUFF_DRIFT_PX_PER_SUBSTEP` | 2 | 每子步的烟雾漂移 |
| `SHIP_DEPARTURE_SMOKESTACK_TILE_X` | 16 | 烟囱的地图位置（tile） |
| `SHIP_DEPARTURE_SMOKESTACK_TILE_Y` | 10.5 | 烟囱的地图位置（tile） |
| `SHIP_DEPARTURE_PUFF_START_SCREEN_X` | 88 | 首个烟雾团的屏幕 X |

`tick() -> Option<ShipDepartureSfx>` 两次触发
`ShipDepartureSfx::Horn`：`Scroll` 的第一帧（第 123 帧）与
`Erase` 的第一帧（第 1147 帧）。

该状态机不改动地图。游戏在 `Erase` 转换点自行应用船体地图
块的抹除与码头→船上 warp 的移除；`ship_erased()` 在
`Erase` 与 `Done` 期间返回 true，为那些在改动生效前绘制的
渲染器覆盖同一帧。

卷屏访问器：`frame()`、`scroll_iteration()`（0..=7）、
`scroll_substep()`（跨全部迭代的 0..=127）、`scroll_px()`
（0..=128；视图每次迭代推进 16px，再按每个 8 帧子步多走
1px；抹除阶段保持完全卷动的位置）。

烟雾团：`puff_count()`（≤ 8，每次迭代新增一团）、
`puff_x_offset(i)`（第 `i` 团在屏幕 X = 88 − 16i 处生成，
并从其生成子步起每子步漂移 +2px；渲染器通过加上
`smokestack_screen_x - SHIP_DEPARTURE_PUFF_START_SCREEN_X`
换算到自己的视图）、`puff_screen_y()`（= 84，烟囱所在行）。

## 示例

驱动一次传送旋转直到结束，并收集其音效提示：

```rust
use dotzuki_engine::overworld::presentation::{
    TeleportSpinSfx, TeleportSpinState, SPIN_IN_PLACE_FRAMES,
};
use dotzuki_engine::overworld::Direction;

fn main() {
    let spin_order = [
        Direction::Down,
        Direction::Left,
        Direction::Up,
        Direction::Right,
    ];
    let mut spin = TeleportSpinState::new(Direction::Down, spin_order);

    let (mut loops, mut rises, mut frames) = (0, 0, 0u16);
    while !spin.is_done() {
        match spin.tick() {
            Some(TeleportSpinSfx::SpinLoop) => loops += 1,
            Some(TeleportSpinSfx::Rise) => {
                rises += 1;
                // 上升音效在上升阶段开始处触发。
                assert_eq!(frames, SPIN_IN_PLACE_FRAMES);
            }
            None => {}
        }
        frames += 1;
    }
    assert_eq!((loops, rises), (4, 1));
    assert_eq!(frames, 136 + 17 + 10); // 原地 + 上升 + 收尾延迟
}
```

*由 `crates/dotzuki-engine/src/overworld/presentation.rs` 中的
`spin_sfx_schedule` 验证。*

## 跨动画的注意事项

- 以固定帧率 tick 每个状态，并在一次性动画播放期间冻结
  gameplay；所有计数都是帧，不是秒。
- `EnterMapSpinState` 初始隐藏；游戏在到达淡入完成后才开始
  tick 它。
- `ShipDepartureState` 从不改动地图；游戏在 `ship_erased()`
  翻转为 true 时自行应用抹除与 warp 移除。
- 水面 tile 的符号约定：源列按 `(x - shift) mod 8` 采样。
