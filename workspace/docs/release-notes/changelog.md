# Changelog

> - **Audience**: rust developers, game authors
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.5.4

Engine version history. Version numbers follow the workspace version
(`workspace/Cargo.toml`, shared by every `dotzuki-*` crate); each release ships
with a migration guide under `migration/` (created per release).

## Format

- Each version lists **breaking changes** first (with a link to its migration
  guide), then notable additions and fixes.
- Doc bodies do not mention "since vX.Y" — this page is the single place for
  version history (doc-standard §10).

## Unreleased

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
