# Dotzuki Editor

A **game-agnostic** visual editor for games built on [dotzuki-engine](../../crates/dotzuki-engine/).  
Configure it once via `.dotzuki-editor.json`, then edit maps, scripts, data tables, and assets — without writing code.

## Quick Start

A **game project** is a zero-Rust directory: a `.dotzuki-editor.json` manifest
plus data, DSL, and asset files — no `Cargo.toml`, no `src/main.rs`. The
layout is specified in [the project manifest reference](../../docs/reference/project-manifest.md).
There are three ways to create one. New here? Follow the guided tour:
[**Your First Game in 15 Minutes**](../../docs/tutorials/editor-first-game.md).

Every scaffolded project comes with **starter content** you can explore right
away: a demo town map (*StartTown*) with its own procedurally generated
tileset and welcome scene, a seeded shared tile library, the Story Designer
activity (narrative bible under `data/stories/`), and — for the game
templates — sample data records plus a seeded character and quest.

Install and start the editor first (pnpm is the package manager here):

```bash
cd tools/dotzuki-editor
pnpm install
pnpm dev          # http://localhost:5174
```

### ① Describe your game to the AI

With no project open, the welcome screen leads with a textarea — pitch your
game in one line and hit **Start** to open the embedded assistant chat (no
project required). Its `draft_project_scaffold` tool proposes a structured
plan card; **Apply** scaffolds the project and the chat continues with
next-step guidance. Inside an open project the assistant can also
`propose_project_config` (edit the manifest) and `propose_map_create`
(create a full map).

Above the chat input, context-aware quick-prompt chips send a canned
instruction with one click — **🎮 Create a game** on the welcome screen,
**🧑 Refine character** in the Story activity (carrying the selected record
id), **🗺 New map** in Maps, and a **🧭 What's next** fallback elsewhere.

AI features need a provider profile first: profiles (Anthropic or any
OpenAI-compatible endpoint) are stored **without API keys** — per project in
`.dotzuki-editor.providers.json`, or globally in `~/.dotzuki-editor/providers.json`
when no project is open. Keys live only in the browser's `localStorage` and
are sent per request.

### ② Create with the wizard

The welcome screen's wizard card (**Create with the wizard** — an equal-weight
card next to the AI pitch before a provider is configured, a secondary link
afterwards) opens a three-step wizard: name your game, pick a template
(`?lang=zh` localizes the template list), and choose where it goes — step 1
has a **directory name** field (defaulting to a slug of the game name) with a
full-path preview, and the Electron app adds a native **Browse…** picker. The
server scaffolds the project in a subdirectory of its project root
(`GET /api/project/root`), refusing a non-empty target with **409**. When the
editor is started from its own repo without `DOTZUKI_PROJECT_ROOT`, that root
defaults to `~/dotzuki-projects`, so new projects land in
`~/dotzuki-projects/<name>` instead of inside the editor checkout. On success
the panel summarizes what was scaffolded and you can jump straight into the
editor or hand off to the AI assistant. Returning users also get recent
projects and an open-by-path row on the welcome screen.

### ③ Write the manifest by hand

Create a `.dotzuki-editor.json` in your game project root. This is the same
shape the wizard scaffolds — five activities, scripts in the Game DSL
(`.scene`), and a `tiles` activity backing the map editor's tile library:

```json
{
  "name": "My Game",
  "dataRoot": "./data",
  "gfxRoot": "./gfx",
  "activities": [
    {
      "id": "maps",
      "type": "map",
      "label": "Maps",
      "icon": "map",
      "config": { "mapsDir": "maps" }
    },
    {
      "id": "scripts",
      "type": "script",
      "label": "Scripts",
      "icon": "code",
      "config": { "scriptsDir": "maps", "extension": ".scene" }
    },
    {
      "id": "data",
      "type": "data",
      "label": "Data",
      "icon": "database",
      "config": {
        "tables": [
          {
            "id": "characters",
            "label": "Characters",
            "dir": "characters",
            "fields": [
              { "key": "name", "type": "string", "label": "Name" },
              { "key": "hp", "type": "number", "label": "HP" },
              { "key": "element", "type": "select", "label": "Element",
                "options": ["fire", "water", "earth", "wind"] }
            ]
          }
        ]
      }
    },
    {
      "id": "assets",
      "type": "assets",
      "label": "Assets",
      "icon": "image",
      "config": { "roots": ["gfx"] }
    },
    {
      "id": "tiles",
      "type": "tiles",
      "label": "Tiles",
      "icon": "tiles",
      "config": { "tilesDir": "tiles", "tileSize": 16, "backdropMapsDir": "maps" }
    }
  ]
}
```

Then start the editor from your **game project root**:

```bash
npx vite --config ../path/to/dotzuki-editor/vite.config.ts
```

Or run `pnpm dev` from `tools/dotzuki-editor/` itself. The dev server listens on **http://localhost:5174**.

### From the command line: `dotzuki` CLI

The [`dotzuki` CLI](../../crates/dotzuki-cli/) scaffolds, checks, and *plays* game
projects without the editor:

```bash
dotzuki new my-game --title "My Game"   # scaffold the same zero-Rust layout
dotzuki check ./my-game                 # compile-check all DSL files, exit 1 on diagnostics
dotzuki run ./my-game                   # play it — windowed, or --headless --screenshot out.png
                                     #   --watch hot-reloads scenes and the current map on save
```

`check` reads the manifest, collects every directory that may hold DSL files
(scene dir, script dirs, story scenes, GUI root), and compiles them in memory
via `dotzuki-engine-dsl`'s runtime `compile_dirs` API. `run` (via the
`dotzuki-runner` crate) boots the entry map — overworld walking, NPC dialogue
and choices, warps, music/SFX from `data/audio/**/*.json`, save/load at
`<project>/.dotzuki-save.json` — with the exact behavior specified in
[the project manifest reference](../../docs/reference/project-manifest.md#what-dotzuki-run-does).
Battles run when the manifest has a `battle` section (see the spec's battle
chapter): the whole party table fights (switching included), battle-usable
items come from the `items` block, and skills can be authored as `rules.ron`
`kind: Move`/`Status` effect records whose hooks run through the engine's
effect stack (e.g. the seeded `venom-sting` → 30% poison, `poison` → 1/8
max-HP residual chip); `dotzuki check` fully compile-validates the hooks.
An optional `encounters` block arms enemy parties and trainer battles:
`startBattle` resolves encounter records first (an ordered enemy queue —
faint → send-out, EXP sums — with a trainer flag that blocks the Run root
entry and pays the record's `money` on a win), then single enemy records
(implicitly wild, Run always works and returns `"run"` to the scene).
Overworld menus and shops work too: **Start** opens a pause menu (party
view, bag with usable heal items, save), `openShop` in a scene opens a
Buy/Sell shop against the player's money (manifest `shop` section; selling
pays `floor(price / 2)`), and a
lost battle triggers a game-over whiteout (party healed, back to the entry
spawn). With a `battle.levels` block (seeded in the dotzuki template) wins pay
EXP from the enemies' `exp` fields, party members level up on an 8·L³ curve
(+5% stat growth per level, heal-the-delta on level-up), and level/exp
persist in the save. Abilities, held items and weather are data-driven too:
a combatant record's `ability`/`heldItem` fields name `kind: Ability`/`Item`
records (the seeded Aria has `intimidate` — −1 foe attack on switch-in;
Bryn holds `leftovers` — 1/16 max-HP heal after his actions), and a scene
can arm a `kind: Weather` record for the next battle with
`game.setWeather("sandstorm")` (battle-local, never saved; the seeded
sandstorm chips every combatant 1/16 max HP per round).

## Desktop App (Electron)

The editor also runs as a native **Electron** desktop app — same Vue UI, same
`/api` surface, just wrapped in a window with a native *File → Open Project…*
folder picker (`Cmd/Ctrl+O`) instead of a browser tab.

```bash
# Dev — hot-reloading Vite renderer inside an Electron window
pnpm electron:dev
pnpm electron:demo      # ...pointed at ./test-project
pnpm electron:pokered   # ...pointed at the pokered repo root

# Production preview — build the renderer + bundled server, run unpackaged
pnpm electron:preview

# Package a distributable (writes to release/)
pnpm electron:pack      # unpacked app dir (fast, no installer)
pnpm electron:dist      # dmg/zip (mac), nsis (win), AppImage (linux)
```

Tagging the repo `vX.Y.Z` (or publishing a GitHub Release) also triggers
`.github/workflows/release-editor.yml`, which packages the editor for macOS
(arm64 + x64) and Windows on CI — release-profile WASM builds — and attaches
the installers to the Release. (Linux users build the AppImage locally with
`pnpm electron:dist`; CI doesn't package Linux.) The version comes from
`workspace/Cargo.toml` — the same single source the crates.io release uses —
so the installers always carry the workspace version.

> **Code signing & notarization (optional).** Packaging config lives in
> `electron-builder.cjs`. By default it produces an **unsigned** build — fine to
> run locally or share over intranet/USB, but a Mac that *downloads* it will be
> blocked by Gatekeeper (this is about signing, not the `.dmg` format). A
> double-click-to-open build needs a paid Apple Developer Program account; then
> set `CSC_LINK`/`CSC_NAME` (Developer ID cert) + `APPLE_TEAM_ID` +
> `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD` and the config auto-enables signing +
> notarization — no code changes. The exact env vars are documented at the top
> of `electron-builder.cjs`; hardened-runtime entitlements + icon slot live in
> `build/`. For unsigned copies, recipients run
> `xattr -dr com.apple.quarantine "Dotzuki Editor.app"` or use *Open Anyway* in
> System Settings → Privacy & Security.

**How it's wired** — in dev, the Electron window loads the Vite dev server,
which already serves the app *and* the full `/api` surface. In production there
is no Vite, so `electron/api-server.ts` rebuilds the identical API by mounting
the same `server/api/routes/*` modules onto a `connect` app and serving the
built `dist/` on one local HTTP origin (the renderer talks to relative
`/api`, `/gfx`, `/wasm` URLs, so API and assets must share an origin). See
`electron/` (`main.cjs`, `preload.cjs`, `api-server.ts`, `dev.mjs`).

> **China mirror for the big Electron download.** Electron ships a ~100 MB+
> binary. `.npmrc` in this folder already points the download at the
> npmmirror (淘宝) mirror. If it's still slow, set them explicitly:
>
> ```bash
> export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
> export ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
> pnpm install
> ```
>
> pnpm 10 blocks dependency build scripts by default; Electron/esbuild are
> allow-listed via `onlyBuiltDependencies` in `tools/pnpm-workspace.yaml`.

> **WASM layout preview when packaged.** The `ui` activity's preview (`/wasm/*`)
> is served from `crates/dotzuki-web/pkg`. `pnpm electron:build` stages that pkg
> into `dist-electron/wasm-pkg` (via `electron/stage-resources.mjs`) and ships
> it as an `extraResources` entry (→ `Resources/wasm-pkg`); the packaged app
> points its `/wasm` route there through `DOTZUKI_WASM_ROOT`. Run `pnpm build:wasm`
> **before** packaging so the pkg exists — otherwise packaging still succeeds,
> just without the preview. (`build:wasm` is a `--dev` build for fast
> iteration; `build:wasm:release` / `build:wasm-runner:release` produce the
> release-profile pkgs CI ships in the installers.) Dev and `electron:preview`
> read the in-repo pkg directly.
>
> The same applies to the `play` activity's runner bundle
> (`crates/dotzuki-runner-web/pkg`, built by `pnpm build:wasm-runner`, staged to
> `dist-electron/wasm-runner-pkg`, located via `DOTZUKI_RUNNER_WASM_ROOT`). The
> `/wasm` middleware serves `dotzuki-runner-web/pkg` as a fallback for filenames
> not found in `dotzuki-web/pkg`.

## How It Works

1. The editor reads `.dotzuki-editor.json` from the current working directory
2. It exposes a Vite dev server with API endpoints for reading/writing game data
3. The UI renders activity tabs based on your config — no game-specific hardcoding

## Project Structure

```
tools/dotzuki-editor/
├── package.json
├── vite.config.ts          # Dev server + API middleware
├── vitest.config.ts        # Unit tests (vitest, node env)
├── playwright.config.ts    # E2E tests (Playwright → Vite dev server)
├── tsconfig.json
├── index.html
├── server/                 # Dev-server middleware: the whole /api surface
│   ├── scaffold.ts         # Zero-Rust project scaffolder (wizard + AI Apply)
│   ├── api/routes/         # project, maps, data, sprites, stories, tiles, …
│   └── actions/            # AI assistant (chat, tools, provider profiles)
├── electron/               # Desktop shell (main process, bundled API server)
├── e2e/                    # Playwright specs + fixtures/demo-game/ + serve.mjs
└── src/
    ├── main.ts
    ├── App.vue              # Tab-based shell
    ├── router.ts
    ├── types/
    │   └── project.ts       # .dotzuki-editor.json TypeScript types
    ├── stores/
    │   ├── project.ts       # Project config loading
    │   └── editor.ts        # Editor UI state
    ├── activities/
    │   ├── MapActivity/     # Visual map editor
    │   ├── ScriptActivity/  # CodeMirror JS editor
    │   ├── DataActivity/    # Schema-driven data editor
    │   ├── AssetActivity/   # Asset browser
    │   ├── TilesActivity/   # Shared tile library
    │   ├── PlayActivity/    # In-editor playtest (WASM dotzuki-runner canvas)
    │   └── StoryActivity/   # Story Designer (bible, graph, AI assist)
    ├── composables/         # Shared reactive state
    └── components/          # Reusable UI components (incl. assistant/, wizard)
```

## Tests

```bash
pnpm test          # unit tests (vitest, node env) — server routes/actions +
                   # client composables/pure logic, colocated *.test.ts files
pnpm test:e2e      # E2E (Playwright) — boots the real editor against a fixture
                   # project and drives it in Chromium
```

Unit tests follow the colocated `foo.test.ts` convention; server route tests
share the mock-connect scaffold in `server/api/testUtils.ts` (temp project root
per test, no real HTTP server).

E2E specs live in `e2e/*.spec.ts`. The Playwright `webServer` (`e2e/serve.mjs`)
copies `e2e/fixtures/demo-game/` to a gitignored scratch dir and starts the
Vite dev server with `DOTZUKI_PROJECT_ROOT` pointing at that copy, so tests may
create/edit/delete project data freely. A second server (on the adjacent port)
serves `e2e/fixtures/playable-game/` — a scaffolded StartTown project — for
`play.spec.ts`, which boots the WASM runner in the browser (needs
`pnpm build:wasm-runner`; the spec skips itself when the pkg is missing).
E2E ports default per-worktree (derived from the checkout path in
`e2e/ports.ts`, range 21000–25999) so parallel checkouts never collide;
set `E2E_PORT` (and optionally `E2E_PLAY_PORT`) to override.
Browsers come from the local Playwright cache (`npx playwright install chromium`
if missing, or set `E2E_CHROMIUM_PATH` to a specific binary). Tests run
serially (`workers: 1`) because they share one dev server and scratch project.

## Available Activities

| Activity | Type | Description |
|----------|------|-------------|
| **Maps** | `map` | Visual tile map editor with painting, collision editing |
| **Scripts** | `script` | CodeMirror 6 editor for game scripts (`.scene` Game DSL) |
| **Data** | `data` | Schema-driven JSON editor — define tables with field schemas, editor auto-generates forms |
| **Assets** | `assets` | Browse and preview game graphics (tilesets, sprites) |
| **Tiles** | `tiles` | Shared tile library backing the map editor's tile picker and backdrop workflows |
| **Story** | `story` | Story Designer — narrative bible, story graph, AI-assisted authoring (see below) |
| **Play** | `play` | In-editor playtest — runs the project in the WASM dotzuki-runner (see below) |

## Play (in-editor playtest)

The `play` activity runs the project **inside the editor** — no Rust toolchain,
no external terminal. It boots the WASM build of `dotzuki-runner`
(`crates/dotzuki-runner-web`, the same `RunnerGame` that powers `dotzuki run`) on a
canvas: walk, talk to NPCs, battle, shop, save.

- **Build the bundle first**: `pnpm build:wasm-runner` (wasm-pack →
  `crates/dotzuki-runner-web/pkg`). Without it the activity shows a setup hint.
- **How it loads**: the page fetches `GET /api/play/bundle` (the whole project
  as `{ path: base64 }`), hands it to the runner's in-memory VFS
  (`MemoryFiles`), then drives one frame per ~59.7 Hz tick
  (`tick(input_bitmask) → 320×240 RGBA` → `putImageData`).
- **Controls**: Arrows/WASD move, Z = A, X = B, Enter/Space = Start,
  Backspace/Right Shift = Select.
- **Saves** persist to `localStorage` (`dotzuki-play-save:<projectRoot>`) and are
  restored on the next boot; **Clear save** wipes them, **Restart** re-fetches
  the bundle and reboots — the poor-man's hot reload after editing content.
- **Audio**: `data/audio/` tracks play through WebAudio — the runner renders
  GB-APU PCM per tick (`take_audio()`), the page queues it into an
  `AudioContext` (starts on your first click/keypress per browser autoplay
  policy; 🔊/🔇 toggles mute).
- **Limits**: no file watching (use Restart), and very short
  key taps shorter than one frame can be missed (same as the native shell).

New projects scaffolded by the wizard include the Play activity by default.
For existing projects, add it to `.dotzuki-editor.json` manually:

```json
{ "id": "play", "type": "play", "label": "Play", "icon": "play", "enabled": true, "config": {} }
```

## Maps

The `map` activity is a visual tile editor: paint tiles, edit collision, place
NPC/warp entities, and stamp multi-tile buildings. Two backdrop workflows help
you start a map from a picture:

- **AI backdrop** (`✨ Backdrop`) — generate an art-reference image (`source.png`)
  for a map from a text prompt, using a configured image provider.
- **Reference → tilemap** (`🗺 Trace to map`) — turn that reference image straight
  into a real, **editable** tilemap. It slices the backdrop into a tile grid,
  dedupes identical cells into a tileset (`tileset.png`), and fills the ground
  layer — so the picture *becomes* the map, ready to clean up by hand. Optional
  color-reduction / pixel-grid snapping (deterministic, via `/api/cv-process`)
  collapses flat regions into shared tiles instead of one unique tile per cell.
  `New from ref` remains available to instead author a *blank* map sized to the
  reference and trace over it manually. (Both require a `tiles` activity, which
  backs the shared tile library.)

## Story Designer

The `story` activity turns the editor into a narrative-design workbench:

- **Narrative bible** — characters, quests, and arcs stored as JSON records under
  `storiesDir` (plus a `graph.json`), edited with dedicated forms
  (`CharacterEditor`, `QuestEditor`, `ArcEditor`). Text fields are localized
  per the configured `locales` (default `["en", "zh"]`).
- **Story graph** — visualizes the quest/arc DAG and cross-references quests
  with their `.scene` implementations (`scenesDir`) and event flags.
- **Flag discovery** — `GET /api/flags` scans the project for event flags so
  quests can link to the flags that gate them (configurable via `flagSource`).
- **Issues panel** — surfaces consistency problems (broken references,
  unimplemented quests).

AI assistance (optional) is built on the Vercel AI SDK with configurable
provider profiles (Anthropic or any OpenAI-compatible endpoint). Profiles are
stored **without API keys** — per project in `.dotzuki-editor.providers.json`,
falling back to a global `~/.dotzuki-editor/providers.json` when no project is
open; keys live only in the browser's `localStorage` and are sent per request:

- **Character refinement** — SSE-streamed LLM pass that fleshes out a character
  profile in all configured locales.
- **Scene generation** — converts a quest into a Game DSL `.scene` file
  (SSE-streamed); *apply* writes it into the project and validates it.

#### Scene validation

Every scene check (the assistant's `check_scene` tool, *apply* in the Scene
Generator, and the scheduled scene-check job) runs through the same chain, in
priority order:

1. **`scene.checkCmd`** (legacy name: `scene.validateCmd`) — a project-configured
   shell command run against a temp copy of the draft, with `{file}` / `{scene}`
   placeholders. Use this when your game ships its own stricter checker.
2. **Built-in WASM compile (default)** — the editor loads the real Game DSL
   compiler in-process (nodejs-target dotzuki-web pkg, `crates/dotzuki-web/pkg-node`,
   built by `pnpm build:wasm`; packaged apps ship it as
   `Resources/wasm-node-pkg`). Syntax/semantic errors come back with the
   compiler's own message and position.
3. **Lint layer** — the deterministic lint (dangling event flags, `game.*`
   calls not in the engine API) always runs on top of a successful compile, and
   any warn-level finding still fails the check. If the WASM pkg is unavailable
   the check degrades to lint only, clearly labeled as NOT a full compile.

Scope note: the built-in compile is *single-file* — it does not detect route
conflicts across scenes or invalid `game.*` command names; the lint layer
covers the latter.

The assistant panel's **🕒 scheduled jobs** run background tasks while the
project is open: a **scene check** re-lints every `.scene` on an interval, and
an **agent prompt** runs a headless chat round whose proposals wait in the
review tray (background runs never auto-apply). Jobs persist per project in
`.dotzuki-editor.jobs.json`; a badge on the 🕒 button counts unreviewed runs.

The assistant also exposes **map / reference-image skills** it can call directly
(not proposals — they create or overwrite *regenerable art assets*, same as the
✨ buttons):

| Tool | What it does |
|------|--------------|
| `list_image_providers` | Check which image providers are configured/credentialed |
| `generate_map_backdrop` | Generate a map's AI art-reference image (`source.png`) from a prompt |
| `edit_map_backdrop` | Multimodal AI edit of an existing `source.png` (keeps size/style) |
| `trace_backdrop_to_map` | Turn `source.png` straight into an editable tilemap (tile library + `tileset.png` + `map.tmx.json`); needs a tiles activity, refuses maps that already have a tilemap |
| `generate_title_backdrop` | Generate the title-screen background (`title-screen` activity's `bgImage`) |

They need an **image provider whose key was saved in the browser** (Settings →
Image providers); the agent checks with `list_image_providers` first. New maps
still go through `propose_map_create` (optionally with `width`/`height` to also
create a blank tilemap) and land in the review tray.

### Sprite Studio

Each character's editor embeds a **Sprite Studio** for displaying and designing a
character's sprites across categories — by default the engine-native set:

| Category | Grid | Cell | Notes |
|----------|------|------|-------|
| `overworld` | 4 rows × 5 cols | 24×32 | row = facing (down/up/left/right); cols = stand, walk×2, **run×2** |
| `portrait` | 1×1 | 64×64 | battle 立绘 |
| `dex` | 1×1 | 64×64 | bestiary/图鉴 立绘 |
| `head` | 1×1 | 32×32 | dialogue 头像 |

Each sprite set lives on disk as `gfxRoot/<category.dir>/<id>/sheet.png` (+ per-frame
PNGs) — the same layout the engine's `WalkSprite` / battle / bestiary loaders read.
The studio provides:

- **Animated preview** — cycles the walk/run frames per facing (stand/walk/run +
  play/speed) for `overworld`; a scaled still for the 1×1 categories.
- **Per-frame pixel editing** — click any cell to open it in the shared pixel
  editor (cropped to the cell); the edit is stitched back into `sheet.png` on save.
  Empty cells are paintable, so you can author the run frames into an existing
  walk-only sheet.
- **Import** — replace a whole sheet from a PNG.
- **AI generation** — the *Generate* button runs the project's configured
  `sprite.generateCmd` (a shell-out, like `scene.validateCmd`), passing
  `{id} {category} {rows} {cols} {cell} {prompt}`. The command produces the sheet
  itself (e.g. the wuxia Gemini `character-sprite-gen` skill). Omit `generateCmd`
  to hide the button.

Categories are configurable per project via `sprite.categories` (omit for the
built-in defaults above).

### AI Animation (PerfectPixel pipeline)

The Sprite Studio also embeds an **AI Animation** panel that generates a complete
*animated* sprite sheet from a one-line brief — a faithful TypeScript port of the
[PerfectPixel](https://github.com/gykim80/perfectpixel-studio) generation pipeline,
running entirely in the dev-server middleware (no extra binary, no shell-out). It
uses a dedicated **image-generation provider** (Settings → *Image generation
providers*), kept separate from the text/story providers.

Pick a **motion preset** (100+ keywords: walk, run, attack, cast, …) and optionally
an **8-direction set** (5 directions generated, the 3 mirror sides derived for free),
and it runs, per state:

```
brief + style + motion → AI filmstrip (magenta key)
   → YCbCr chrominance matting + despill + flood-fill   (background removal)
   → projection-profile + DP optimal-cut                (frame segmentation)
   → alpha-weighted centroid + shared scale + baseline  (rock-steady alignment)
   → shared-palette median-cut + grid snap              (true pixel art)
   → histogram + dHash + motion/contact scoring         (quality 0–100)
   → pass ✓  |  fail → measurement-driven retry hint → regenerate (up to 3×)
```

The panel shows live progress, an animated preview per state, a 0–100 quality
score, and a **regenerate-with-feedback** box. Output is written to
`gfxRoot/<sprite.animatedDir>/<id>/` (default `data/gfx/animated/<id>/`):

- `sheet.png` — atlas (row = state, col = frame)
- `manifest.json` — schema-v2 metadata (per-state fps/loop/frame rects, content
  trims, shared foot pivot)
- `sprite-sheet.json` — **Aseprite-compatible** (Phaser/Unity/Godot importers)
- `<state>_<NN>.png` — individual frame PNGs

**Image providers** are configured separately from text providers (kept in
`.dotzuki-editor.image-providers.json`), `kind`:

- **`gemini`** — Google `generateContent` (Nano Banana: `gemini-2.5-flash-image` /
  `gemini-3-pro-image`). **Recommended** — it's multimodal, so the base character
  (and a front-view motion strip for 8-direction sets) is attached as a *reference
  image* to lock identity across the strip. Behind a firewall, set a **Proxy** on
  the provider (e.g. `http://127.0.0.1:9085`) — or launch the dev server with
  `GEMINI_PROXY` / `HTTPS_PROXY`.
- **`openai`** — any OpenAI-compatible images endpoint. Text→image only (no
  reference image), so identity holds via the brief + shared-palette quantization
  + the drift-detection retry loop. The base sprite still drives a server-side
  identity-drift *check* either way.

Story activity config (`StoryActivityConfig`):

```json
{
  "id": "story",
  "type": "story",
  "label": "Story",
  "icon": "book",
  "config": {
    "storiesDir": "stories",
    "scenesDir": "maps",
    "locales": ["en", "zh"]
  }
}
```

Optional keys: `flagSource` (where to discover event flags), `ai` (extra
context references for prompts), `scene` (generation target + `checkCmd`
validation command — see *Scene validation* above), `sprite` (Sprite Studio —
`categories`, `generateCmd`, plus the legacy single-image `dir`/`size`).

## API Endpoints

All endpoints are relative to `dataRoot` or `gfxRoot` from your config.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/project` | Project configuration |
| GET | `/api/project/templates` | New-project templates (`?lang=zh` localizes name/description) |
| POST | `/api/project/create` | Scaffold a new zero-Rust project (409 on non-empty target) |
| POST | `/api/project/open` | Open a project directory by path (404 when no manifest; the Electron shell offers to initialize it) |
| GET | `/api/project/root` | Base directory new projects are created in |
| GET | `/api/play/bundle` | Whole-project playtest bundle: `{ files: { "<posix path>": "<base64>" }, projectRoot }` (400 with no project open, 413 past the 16 MB/file + 64 MB total caps) |
| GET | `/api/data/list/:tableId` | List records in a table |
| GET | `/api/data/record/:tableId/:file` | Read a single record |
| PUT | `/api/data/save/:tableId/:file` | Save a record |
| DELETE | `/api/data/delete/:tableId/:file` | Delete a record |
| GET | `/api/scripts/*` | Read script file |
| PUT | `/api/scripts/*` | Write script file |
| GET | `/api/maps/*` | List map files or read map JSON |
| PUT | `/api/maps/*` | Write map file |
| POST | `/api/maps-create` | Create a new map directory |
| GET | `/api/sprites/categories` | Sprite Studio category defs |
| GET | `/api/sprites/meta` | A character's sprite-set metadata (sheet dims, frames) |
| GET | `/api/sprites/file` | Serve a sprite PNG (`sheet.png` / a frame) |
| POST | `/api/sprites/save` | Write a sheet (+ pre-sliced frames) |
| POST | `/api/sprites/generate` | Run the configured `generateCmd` |
| GET/PUT | `/api/ai/image-providers` | Image-generation provider profiles (separate from text) |
| GET | `/api/sprites/presets` | Motion preset catalog (AI Animation) |
| GET | `/api/sprites/directions` | 8-direction metadata (AI Animation) |
| GET | `/api/sprites/animated` | An existing animated set's manifest + frames |
| POST | `/api/ai/generate-animated` | SSE: brief → animated sprite sheet (PerfectPixel pipeline) |
| GET | `/gfx/*` | Serve graphic assets |

## For Game Developers

To make your game compatible with Dotzuki Editor:

1. Put your game data in a `data/` directory as JSON files
2. Put your graphics in a `gfx/` directory as PNG files
3. Create `.dotzuki-editor.json` in your project root
4. Define your data tables with field schemas
5. Run the editor from your project root

The editor never requires you to modify its source code. Everything is driven by your `.dotzuki-editor.json` configuration.
