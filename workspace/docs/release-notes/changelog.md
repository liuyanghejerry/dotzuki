# Changelog

> - **Audience**: rust developers, game authors
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.10.1

Engine version history. Version numbers follow the workspace version
(`workspace/Cargo.toml`, shared by every `dotzuki-*` crate); each release ships
with a migration guide under `migration/` (created per release).

## Format

- Each version lists **breaking changes** first (with a link to its migration
  guide), then notable additions and fixes.
- Doc bodies do not mention "since vX.Y" — this page is the single place for
  version history (doc-standard §10).

## Unreleased

- Add [click to move](../how-to/maps.md#click-to-move) to the runner and pointer-enabled hosts.
- Add `dotzuki_mobile_pointer_click` and `dotzuki_mobile_cancel_pointer_input` to the mobile
  C ABI without changing ABI version 1. Earlier ABI v1 libraries do not export these symbols.
  Rebuild the Rust runtime when updating a pointer-enabled shell; the ABI version check alone
  does not establish symbol availability. Existing `MobileGame` implementations keep their
  default pointer callbacks, and the button contract remains unchanged.

Breaking Rust API change:

- Add `NpcRuntimeState::step_direction: Option<Direction>`. Add `step_direction: None` to
  idle NPC struct literals. Manual walking-state fixtures must retain their movement direction
  in this field. Binary save adapters must account for the additional field.

NPC movement fixes:

- Capture the direction when each autonomous or scripted step starts. A change to `facing`
  during that step no longer redirects the remaining movement or its occupied destination.
- Use `NpcRuntimeState::walking_direction()` for movement offsets and collision predictions;
  keep `facing` for the sprite's orientation.
- Preserve the captured direction in JSON snapshots. Legacy JSON without `step_direction`
  loads with `None` and falls back to its saved facing. Completed steps remove the captured
  direction; consecutive scripted steps capture their next direction independently.

## v0.10.1

This patch release restores DSL compilation on bare-metal targets and includes the NPC hooks
used by consumers of `fix/gba-psg-audio`. See the [migration guide](migration/v0.10.1.md).
Existing APIs retain their behavior; there are no breaking changes.

- Replace the DSL integer check's unavailable `f64::fract()` call with a no_std-compatible
  check. Preserve accepted integer ranges and rejection of invalid arguments.
- Check both audio and DSL libraries on `thumbv4t-none-eabi` in CI.
- Add an opt-in callback for visible, idle stationary NPCs in the movement traversal.
  Existing entry points keep their stationary-NPC behavior.
- Collect NPC occupied tiles in one preallocated vector, preserving collision semantics.

## v0.10.0

This release integrates the GBA audio and gameplay fixes previously available only on the
`fix/gba-psg-audio` branch. See the [migration guide](migration/v0.10.0.md).

Breaking change:

- `NpcRuntimeState::delay_counter` changes from `u8` to `u16` to represent a 256-frame
  countdown. Update typed assignments and binary save adapters.

Runtime additions and fixes:

- Support default-feature-free bare-metal audio and optional register forwarding to physical PSG
  hardware. Preserve sparse music/SFX channel positions and release completed sound waiters.
- Correct pitch-slide initialization, fractional carry, and target termination.
- Add an opt-in classic NPC wander policy; the existing entry point retains its default policy.
- Add a callback before each acting battler and a defaulted resolved-move hook after the
  status gate. These support consumer-owned trainer actions and called moves.
- Terminate outward spiral transitions after their bounded traversal.

## v0.9.1

This patch release preserves Rust APIs and replaces the exported mobile control layout.
See the [migration guide](migration/v0.9.1.md) before regenerating custom shells.

- Android and HarmonyOS render safe-area-aware landscape controls over the game surface.
  Shared pointer ownership supports movement plus actions, retains short taps, and releases
  input on focus loss, cancellation, and resize.
- Persist control size, position, opacity, mirrored layout, floating direction pad, and
  optional haptics. Reserve space above bottom dialogue, including on taller HarmonyOS screens.
- Provide a reusable UIKit Swift package and integration guide for game-owned iOS shells.
- Add shared sanitizer tests, Android native instrumentation, and iOS simulator CI.
- Fix release automation to install supported Android SDK packages.

## v0.9.0

This release includes breaking UI API changes and requires Rust 1.88 or newer.
See the [migration guide](migration/v0.9.0.md) before updating consumers.

Breaking changes:

- Remove deprecated `DialogConfig`, `FlexMenuConfig`, `YesNoConfig`, their
  legacy drawing wrappers, and the legacy flex-menu `EdgeInsets`, `Justify`,
  and `SizeMode` types. Use `MenuConfig` and the current widget drawing functions.
- Static layout `Context::set` returns `Result<(), ContextCapacityError>`
  instead of panicking when the binding array is full. Handle the result.

Runtime additions and fixes:

- Configure actor walk/run speeds, override movement speed for vehicles or
  terrain, and offset actors during caller-driven scenes. Default speeds remain
  2/4 pixels per update.
- Buffer short button taps until the game shell's next update and discard held
  and pending input on focus loss. Multiple taps within a frame coalesce.
- Synchronize Android and Harmony runner lifetimes, reject out-of-range DSL
  numeric conversions, align native and Boa command behavior, and implement
  battle hook scopes and handler speed ordering.

Editor and verification:

- Author cardinal and 47-mask blob autotiles with visual mask assignment,
  continuous paint/erase strokes, previews, and atomic rule persistence.
- Arrange native-resolution scenery with alpha-aware selection, drag/nudge,
  undo/redo, collision/event overlays, pixel-editor round trips, and revision
  checks when saving `art.json`.
- Add editor language selection and lazy loading, GBA frame-budget checks,
  MSRV/dependency/mobile/browser CI gates, and supported Android SDK setup.

## v0.8.2

This patch release adds trait implementations only; there are no breaking
changes. See the [migration guide](migration/v0.8.2.md) for the consumer
update.

- Add: engine-owned runtime state is serializable — `Serialize` and
  `Deserialize` on the DSL interpreter (`Interpreter`, `InterpState`), the
  trigger manager, NPC runtime state, the cutscene manager, connection
  transitions, `CommandResult`, `Metatile`, and the overworld presentation
  states, plus `Debug` and `Clone` on the DSL `Interpreter`. A game with
  frame-level `save_state` / `restore_state` can snapshot and restore engine
  state directly, instead of pinning a private engine branch.

## v0.8.1

This patch release has no API changes. See the
[migration guide](migration/v0.8.1.md) for the consumer update.

- Fix: HarmonyOS hosts export with a layered launcher icon, which API 11 and
  later require, so the home screen shows the game's own icon instead of the
  system placeholder. Re-export a host to pick up the icon; the
  `dotzuki export --harmony` template and `scripts/export-mobile-host.py` both
  carry the layered bitmaps.
- Fix: Android hosts export with adaptive launcher icons. The manifest now
  points at `@mipmap/ic_launcher`, and the template ships the API 26 layers,
  the legacy icons, and one bitmap per screen density. Re-export a host to pick
  up the icons.

## v0.8.0

This release contains breaking API and feature-gate changes. See the
[migration guide](migration/v0.8.0.md) for consumer updates.

Breaking changes:

- `FrameBuffer::save_png` now requires the `dotzuki-engine/image` feature.
- Boa-backed exports in `dotzuki-engine-script` now require the `script-boa`
  feature. Default-feature consumers retain them; consumers that disable
  defaults must opt in.
- `dotzuki_renderer::mon_icon` now requires the renderer's `resource` feature.
- Engine and DSL public data structures now use their crate-local deterministic
  `HashMap` and `HashSet` aliases instead of `std::collections` types.
- `StoryStmt` gained the `Return` variant. Exhaustive matches must handle it.
- Seven `BattleEffects` rendering methods gained an inferred const storage
  parameter, and `Tile` now has four-byte alignment.

GBA and renderer additions:

- Engine, DSL, script protocol, renderer, UI, rules, app, and audio paths can
  compile with `no_std + alloc` on bare-metal ARM consumers.
- Indexed framebuffers expose explicit packed and word-aligned linear storage.
  The default remains packed on every target; `LinearIndexedFrameBuffer` and
  `LinearRgbaIndexedFrameBuffer` provide one byte per palette index for DMA.
- Indexed tile blits, clipped row-copy paths, framebuffer scrolling, rectangle
  copies, and overlap-safe internal moves reduce CPU and allocation pressure.
- Transient battle-animation state and in-place GBA screen effects let consumers
  reuse stable frames without cloning a 160×144 index buffer.

DSL and layout additions:

- The schema v2 [`static layout`](../reference/glossary.md) compiler lowers
  supported `.gui` screens into
  borrowed Rust layout data while keeping `.gui` as the authored source.
- The native AST core dispatcher and capability traversal centralize built-in
  command validation; bare `return` now has matching parser, native interpreter,
  and JavaScript semantics.

## v0.7.1

This patch release has no API changes.
See the [migration guide](migration/v0.7.1.md) for the consumer update.

- Fix: the published `dotzuki` CLI now includes the mobile ABI C header used
  by Android and HarmonyOS export templates. Crates.io installations can export
  those projects without requiring a source checkout.

## v0.7.0

This release has no breaking API changes. See the
[migration guide](migration/v0.7.0.md) for the consumer update.

- Android: `dotzuki export --android` writes an arm64 Android Studio project
  with a Kotlin Activity, `Choreographer` frame clock, `SurfaceView` renderer,
  `AudioTrack` output, touch controls, lifecycle handling, and
  `SharedPreferences` saves through mobile ABI version 1. The editor exposes
  the same export and release installers include the Android runtime library.
- Mobile hosts: `scripts/export-mobile-host.py --platform android|harmony`
  wraps a custom game's `dotzuki-mobile` static library in either engine-owned
  shell.
- CI cross-compiles the Android runtime and assembles the tutorial export.

- Fix: the debug server's response timeout rises from 5s to 300s, and the
  server drains stale responses before forwarding each command — a slow
  synchronous command (`step_frames` with a large frame budget) no longer
  skews the FIFO response stream. See
  [the debug server reference](../reference/debug-server.md).

## v0.5.4

The workspace version returns to the v0.5.x tag series (0.1.1 → 0.5.4); see
[the migration guide](migration/v0.5.4.md) for the version-line story. The
intermediate `v0.5.2` / `v0.5.3` tags failed the release workflows'
tag↔version assertion while the workspace still read 0.1.1, so they published
nothing — this tag aligns the two again.

Breaking changes (all in the overworld NPC API; details and steps in
[the migration guide](migration/v0.5.4.md)):

- `NpcDefinition` and `NpcRuntimeState` gained the
  `wander_axis: NpcWanderAxis` field — struct literals need the new field.
- `advance_step` no longer ticks `repel_steps`; call the new
  `tick_repel_step` helper from the game's encounter-check gate.
- Wander NPCs follow their axis and no longer have a radial leash; NPC walk
  cadence is 16 frames per tile (half the player's speed).

Game-agnostic systems sunk from the pokered game repo into the engine:

- `dotzuki-engine`: `items::mart` — interactive shop state machine
  (`MartState` + `MartBackend` + a ready-made `MartDriver`), see
  [shops](../reference/shops.md); `overworld::presentation` — frame-counted
  animation state machines (teleport spin, elevator rumble, water/flower
  tiles, fishing rod, boulder dust, ship departure), see
  [overworld presentation](../reference/overworld-presentation.md);
  `link::codec` — shared JSON-line framing codec + broadcast `Frame<M>`
  envelope, see [link play](../reference/link-play.md).
- `dotzuki-engine-dsl`: `disk_loader` — disk-backed scene providers with
  mtime hot reload, see [runtime loading](../reference/dsl/runtime-loading.md).
- `dotzuki-renderer`: `resource` module (feature) — PNG → 2bpp/1bpp/4bpp
  conversion, `AssetRoot` path resolution, the `ResourceManager` asset cache,
  and an embedded-asset seam for wasm/mobile, see
  [resource manager](../reference/resource-manager.md).
- `dotzuki-audio`: `manager` — `AudioManager` (music fades, NR50 master
  volume, cross-track resume states, post-frame hook); `output` — device
  output behind the `cpal` / `web-audio` features, see
  [audio runtime](../reference/audio-runtime.md).
- `dotzuki-app`: `debug_server` — generic TCP JSON-line debug server, see
  [debug server](../reference/debug-server.md); `link` — `TcpTransport` /
  `LinkServer` / the `LinkSession` router, see
  [link play](../reference/link-play.md).
- `dotzuki-web`: `game_shell` feature — pixels+winit game loop for wasm and
  native, see [game shell](../reference/game-shell.md); `link` feature —
  `BroadcastChannel` link transport.
- `dotzuki-ui`: games can inject custom GB tile glyphs into
  `FrameBufferPainter`.

Also in this release:

- Editor: native desktop-style shell with Lucide icons, Electron installers
  attached to GitHub Releases, and cloud hosting support (relative base, AI
  key fallback, graceful shutdown, health endpoints).

## v0.1.1

- Modern file audio (WAV/OGG/FLAC/MP3) behind the runner's `modern-audio`
  feature.
- `dotzuki new --template your-first-game`; the editor's Help panel renders
  reference pages in-app.
- `dotzuki check` fails on a missing `battle.rules`; runner logs surface in
  the CLI.
- Docs site: how-to guides for scenes, UI layouts, and assets (EN + zh-CN),
  plus a glossary backfill.

## v0.1.0

First published release (crates.io). The engine workspace's version line
resets from the v0.5.x pre-release tags (`v0.5.0`, `v0.5.1`) to `0.1.0`;
every `dotzuki-*` crate publishes at 0.1.0, and the tag-driven release
pipeline lands: `workspace/scripts/publish-crates.sh`, the release
workflow, and the package-check PR gate. The code at tag `v0.1.0` is one
commit past `v0.5.1` — no API changes in the jump. Pre-release consumers
switch their git tags from `v0.5.x` to `v0.1.0` (or to the registry form)
per [the migration guide](migration/v0.1.0.md).
