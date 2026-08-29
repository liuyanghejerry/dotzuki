# Glossary

> - **Audience**: all readers
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.5.4

Canonical definitions of dotzuki terms. Link to an entry here the first time
you use a term in a document (doc-standard §4.2); this page is the only
authoritative term list (doc-standard §11.4).

Terms in parentheses are the canonical Chinese translations used across
`-zh-CN` pages (doc-standard §6.4); terms without parentheses keep their
original form in Chinese text.

## Project & authoring

- **zero-Rust project**（零 Rust 项目）— a game built without Rust: a plain
  directory with a `.dotzuki-editor.json` manifest plus `data/`, `gfx/` and
  `assets/` (DSL files), run by the `dotzuki` CLI or the editor. See
  [the project manifest](./project-manifest.md).
- **manifest**（项目清单）— the `.dotzuki-editor.json` file declaring the
  game's layout, entry map, activities and battle section.
- **activity**（活动）— one editing surface in the dotzuki-editor (Maps /
  Scripts / Data / Assets / Tiles / Story / Play); maps to a manifest section.
- **data table**（数据表）— a record collection in `data/` with a fixed
  schema (combatants, encounters, skills, items, levels). See
  [data tables](./data-tables/combatants.md).
- **Game DSL**（游戏 DSL）— the declarative language for scenes and UI:
  `.scene` (storylines), `.gui` (layouts), `.theme` / `.style` (colors &
  styles).
- **`@t("en", "中文")`**（双语文本语法）— bilingual text syntax; compiles to
  per-locale values, and the runtime language selects the value. See
  [the i18n guide](../how-to/i18n.md).
- **RON** — the Rusty Object Notation config format used for battle rules
  (`rules.ron`).

## Engine

- **`GameData`** — the provider trait every game implements to hand data to
  the engine; all identifier types (Map, Item, Species, ...) are generic
  associated types on it, so the engine carries no concrete game data.
- **effect stack**（效果栈）— the battle model: turns run as a stack of
  effects and handlers driven by `dotzuki_engine::battle::stack::StackDriver`.
  See [the effect stack explanation](../explanation/effect-stack.md).
- **`rules.ron`** — the declarative battle-rules file compiled by
  `dotzuki-rules` into runtime effect stacks. See
  [battle rules](./battle-rules.md).
- **runner**（运行器）— `dotzuki-runner`: loads a zero-Rust project
  (manifest, DSL, maps, collision, tilesets) and drives `RunnerGame`; also
  runs headless.
- **headless**（无头模式）— running without a window or audio device, used
  for CI smoke tests and screenshots (`dotzuki run --headless`).
- **Boa** — the JavaScript engine behind `dotzuki-engine-script`; the DSL's
  native AST interpreter mirrors its runtime protocol and is the canonical
  scene semantics.
- **`TrackDef` / `AudioCommand`** — the JSON audio track schema and its 22
  channel commands. See [audio commands](./audio-commands.md).
- **save version**（存档版本）— the version stamp inside `.dotzuki-save.json`;
  older saves load on newer engines, newer saves are refused by older engines.
  See [save compatibility](../explanation/save-compatibility.md).
- **minimon** — the engine demo example (`examples/minimon`): a tiny Rust
  battle system built entirely on the effect stack, with a data-driven
  `rules.ron` counterpart, proving the engine is game-agnostic.
- **WASM runner**（WASM 运行器）— `dotzuki-runner-web`, the web build of the
  runner that powers the editor's Play activity and web playtesting.
- **mart**（商店）— the interactive shop state machine in
  `dotzuki_engine::items::mart`: `MartState` owns the Buy/Sell/Quit flow while
  the game's `MartBackend` implementation owns prices, money, and the bag. See
  [shops](./shops.md).
- **link play**（联机）— two-player battles and trades over the engine's
  transport seam (`NetworkTransport<M>`); concrete transports live in the
  platform crates (TCP native, `BroadcastChannel` on web). See
  [link play](./link-play.md).
- **transport**（传输层）— a `NetworkTransport<M>` implementation moving typed
  messages between link-play peers; sends never loop back, and a dropped peer
  surfaces as `TransportError::Disconnected`.
- **session router**（会话路由器）— `LinkSession`: owns the real transport,
  drains it once per frame, and routes each message into per-activity queues
  (battle / trade) so both activities share one connection.
- **debug server**（调试服务器）— the TCP JSON-line endpoint from
  `dotzuki-app` that lets tests and tooling drive and inspect a running
  native game. See [debug server](./debug-server.md).
- **game shell**（游戏外壳）— the pixels+winit shell in `dotzuki-web`
  (`game-shell` feature) running a `GameLoop` in a browser canvas or a native
  window at GB frame pacing. See [game shell](./game-shell.md).

## Battle stack

- **event**（事件）— a dispatch key in the battle stack (`SwitchIn`,
  `BeforeMove`, ...); effects subscribe handlers to events. See
  [the effect stack explanation](../explanation/effect-stack.md).
- **effect**（效果）— the stack's subscription unit: an id, an `EffectType`,
  and a static table of hooks; every rule compiles to effects hosted on
  battlers, sides, or the field.
- **hook**（钩子）— one `(event, call, order)` subscription an effect
  declares; the unit a handler plugs into.
- **handler**（处理器）— the zero-capture function a hook runs:
  `fn(&mut BattleCtx, RelayVar, target, source, source_effect) -> HandlerResult`.
- **driver**（驱动器）— the code that owns the provider and sequences
  dispatches and rounds; `StackDriver` is the engine's reference driver.
- **dispatch**（派发）— running one event: collect the sorted hooks, then
  fold their handlers.
- **fold**（折叠）— running a `RelayVar` through the collected handlers in
  order; each handler returns a `HandlerResult` that short-circuits or
  continues the fold.
- **`RelayVar`** — the typed fold payload (`Unit | Int | Damage | Accuracy |
  Bool`); Chinese text describes it as the 折叠载荷.
- **lane**（通道）— the typed value space a relay occupies; accessors
  outside the current lane return 0 / false.
- **volatile**（易变状态）— a per-battler effect instance with per-instance
  state (multi-turn locks, Substitute, ...), separate from data-defined
  statuses.
- **re-entrant dispatch**（可重入派发）— driver code firing a sub-event while
  a fold is in flight; handlers cannot re-enter, the driver can.
- **seam**（接缝）— a subscription point that is inert by default and lets
  games extend behavior without engine edits.
- **resolver**（解析器）— a provider method mapping opaque ids or battler
  state to static effects.
- **gate**（门槛）— a veto check a move must pass (status gate,
  `BeforeMove` cost gate, chance gate).
- **veto**（否决）— a `Fail` / `FailSilent` result that cancels a fold.
- **`TurnLog`** — the ordered `TurnEvent` list from `execute_turn_logged`;
  Chinese text calls it the 回合叙述.
- **draw order**（抽取顺序）— the exact RNG byte sequence; the determinism
  credential for parity checks.
- **host / hosted**（托管）— where an effect lives: a battler（战斗者）, a
  side（侧边）, or the field（场地）; resolvers route effects to hosts.
- **provider** — the trait pattern handing game data to the engine
  (`GameData`, `BattleProvider`, `EffectProvider`); kept in English in
  Chinese text.

## Battle gameplay

- **stat**（属性）— a numeric battler attribute (Hp/Atk/Def/Spd/SpA/SpD).
- **base stats**（基准属性）— the record-derived raw stats, before stages
  and growth.
- **stat stage**（属性等级）— the −4..+4 multiplier tier applied per stat.
- **element / type**（元素）— the tag driving type-chart lookups (record
  field `element`, RON `types`); chart phrases use 克制表 / 属性克制 as fixed
  collocations, and the tag itself renders as 元素 to stay distinct from
  stat.
- **type chart**（克制表）— the element-pair multiplier table (`type_chart`
  in `rules.ron`).
- **type effectiveness**（克制倍率）— the multiplier a chart lookup applies
  (super effective, resisted, immune).
- **physical/special split**（物特分家）— the per-move category deciding
  whether Atk/Def or SpA/SpD apply.
- **move**（招式）— an in-battle action (power, accuracy, category) on the
  generic `P::Move` id.
- **skill**（技能）— a data-table record describing a move (name, power,
  element, category, cost); RON `kind: Move` records take over skills.
- **ability**（特性）— a `kind: Ability` record wired through a combatant's
  `ability` field; fires on switch-in and per action.
- **held item**（携带道具）— a `kind: Item` record wired through `heldItem`;
  a persistent flag, never consumed.
- **combatant / battler**（战斗者）— combatant: one data-table record on a
  battle side; battler: the engine-side active unit (`BattlerState` /
  `BattlerRef`).
- **party**（队伍）— the records of the party table; HP/MP/status persist
  across battles and in the save.
- **fainted**（濒死）— at 0 HP; fainted members are not revived by healing
  items.
- **encounter** — an encounter-table record or a walk-triggered map battle;
  kept in English in Chinese text.
- **wild battle**（野怪战斗）— a single-enemy battle where Run always
  succeeds.
- **trainer battle**（trainer 战斗）— an encounter with `trainer: true`: Run
  is blocked and a win pays out money.
- **sceneless battle**（sceneless 战斗）— a walk-triggered battle with no
  scene to resume.
- **switch**（换人）— replacing the active battler; fires `SwitchIn`.
- **residual**（残留效果）— the end-of-action / end-of-turn tick (status
  chip, held-item recovery, weather).
- **whiteout** — the post-loss flow: party healed, player respawns at the
  entry spawn; kept in English in Chinese text.
- **turn loop**（回合循环）— the per-round phase machine (Fight / Party /
  Item / Run → resolution → residuals).
- **heal point**（回复点）— the planned whiteout-respawn alternative on
  maps.

## Maps

- **tile** — one cell of a map grid; kept in English in Chinese text.
- **tileset** — the `tileset.png` atlas plus its Tiled `.tsx` metadata; kept
  in English in Chinese text.
- **atlas** — a packed texture with named regions (`@atlas` in the DSL);
  kept in English in Chinese text.
- **GID** — the 1-based row-major tile id in Tiled maps and tilesets; kept
  in English in Chinese text.
- **elevation**（海拔）— the player's vertical level; lower layers render
  below, higher layers render above.
- **sidecar**（伴生文件）— the editor-written `objects.json` beside a map
  (npcs, warps, signs, encounters).
- **warp**（传送点）— a tile that fades the player to `dest_map`.
- **entity**（实体）— a map object: an NPC, a warp, or a sign.
- **trigger**（触发器）— the mechanism binding storylines to map objects;
  the `@trigger` keyword stays as code.
- **spawn**（出生点）— where the player appears on map load or respawn.
- **entry map**（入口地图）— the map the player boots and respawns on.
- **overworld**（大地图）— the walkable map mode, as opposed to battle,
  dialogue, and menus.
- **collision**（碰撞）— the layer(s) marking solid tiles.

## Assets

- **2bpp** — 2 bits per pixel: the 4-shade Game Boy tile format the
  asset-converter reads; kept in English in Chinese text.
- **palette**（调色板）— the four RGBA colors mapped onto 2bpp indices by
  the asset-converter.
- **sprite**（精灵）— a character or object graphic, drawn from tileset
  tiles.
- **font**（字体）— the text glyph source; the renderer embeds a CJK-capable
  bitmap font, games may substitute their own.
- **gfx** — the conventional loose-graphics directory (an assets-activity
  root); kept in English in Chinese text.
- **embedded asset loader**（内嵌素材加载器）— the
  `fn(&str) -> Option<&'static [u8]>` seam that resolves gfx-relative paths to
  embedded PNG bytes on wasm/mobile targets, where no filesystem exists. See
  [the resource manager](./resource-manager.md).

## Scenes & UI

- **scene**（场景）— a `.scene` file: a `game_scene` document with
  storylines.
- **storyline**（剧情线）— a named async statement sequence bound by
  `@trigger`; `main` is the unnamed entry one.
- **narrator form**（旁白）— `@speaker("")` / `@say("")` lines rendered
  without a name prefix.
- **cutscene speech**（过场对白）— `@say` dialogue inside an auto-triggered
  storyline.
- **command**（命令）— a `game.*` API call from a storyline (bare or
  `@command`).
- **flag** — a persisted boolean (`setFlag` / `getFlag`) carried in the
  save; kept in English in Chinese text.
- **interpreter**（解释器）— the native AST interpreter of
  `dotzuki-engine-dsl`, the canonical scene semantics; Boa is the dev
  fallback.
- **codegen** — the DSL → JS/JSON compile contract; kept in English in
  Chinese text.
- **screen**（屏幕）— the top-level layout of a `.gui` file.
- **component**（组件）— a GUI DSL element (`panel`, `text`, `custom:*`,
  ...).
- **template variable**（模板变量）— a `{var}` string the renderer resolves
  at draw time.
- **hot reload**（热重载）— `--watch` recompiling DSL and reloading the
  current map in place.
- **scaffold**（脚手架）— the tooling that generates a project layout
  (`dotzuki new`, the editor wizard).
- **smoke test**（冒烟测试）— a headless boot of a few frames as a CI check.
- **playtest**（试玩）— in-editor WASM play of `RunnerGame` (the Play
  activity).
- **generic associated types**（泛型关联类型）— identifier types declared on
  the `GameData` trait.
- **battle section**（battle 区块）— the manifest section arming the
  data-driven battle system.
- **story bible**（叙事圣经）— the seeded `data/stories/` narrative content.
- **recipe**（配方）— a cookbook row: host X, subscribe Y, do Z, at order N.

## Audio

- **track**（音轨）— a `TrackDef` JSON document (music or sfx).
- **channel**（通道）— one GB hardware voice (`pulse1` / `pulse2` / `wave` /
  `noise`); the audio channel, distinct from the battle lane.
- **sequencer**（音序器）— the GB-APU playback engine in `dotzuki-audio`.
- **GB-APU** — the Game Boy audio emulation; kept in English in Chinese
  text.
