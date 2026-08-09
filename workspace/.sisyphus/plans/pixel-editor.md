# Pixel Art Editor — game-editor 第 8 个 Activity

## TL;DR

> **Quick Summary**: 在现有 game-editor (Vue 3 + Vite) 中新增像素编辑 Activity，支持宝可梦精灵、Tileset 瓦片、训练师肖像、NPC 精灵的像素级绘制，使用 DMG 4 色调色板，编辑结果直接写回 PNG 文件。
>
> **Deliverables**:
> - 像素画布组件（Canvas 2D，支持缩放 + 网格）
> - 4 种绘图工具（铅笔、橡皮、取色器、填充）
> - DMG 4 色调色板选择器
> - 撤销/重做系统
> - 资产浏览器（按类别浏览全部图形资产）
> - 多帧预览（宝可梦正面/背面切换）
> - Tileset 瓦片提取编辑模式
> - Vite PNG 读写中间件
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES — 4 waves
> **Critical Path**: Task 1 → Task 3 → Task 5 → Task 6 → Task 12 → Task 14

---

## Context

### Original Request
> 在 game-editor 中增加一个像素图编辑能力，以便 Pokemon 的图、地图 Tile 等内容可以在编辑器内闭环完成

### Interview Summary

**Key Discussions**:
- **集成方式**: 作为 game-editor 的第 8 个 Activity 集成，复用现有 Canvas/缩放/中间件基础设施
- **目标资产**: 全部 4 类 —— 宝可梦精灵 (front/back)、Tileset 瓦片、训练师肖像、NPC/Overworld 精灵
- **编辑粒度**: 像素级（不是 tile 重排）
- **调色板**: 硬限制 DMG 4 色 (白 #FFF / 浅灰 #AAA / 深灰 #555 / 黑 #000)
- **动画**: 基础帧预览（前后帧切换，无时间轴）
- **格式**: 仅 PNG，不需要 .2bpp/.pic 转换
- **画布**: 固定尺寸（不缩放画布）
- **图层**: 单层
- **测试**: QA Scenarios 验证（无单元测试框架）

**Research Findings**:
- game-editor 技术栈: Vue 3 + Vite 8 + Pinia 3 + TailwindCSS 4 + TypeScript 5.9 + CodeMirror 6
- Canvas 渲染已有 `useMapRenderer.ts` (249行)，`imageSmoothingEnabled = false`，缩放 1x-4x
- 现有 Activity 模式: `router.ts` route → `Pinia store` → `App.vue` 分支 → 组件
- **关键差异**: 现有 store 操作 JSON 数据，像素编辑器需要操作 PNG 二进制数据
- `/gfx` 中间件当前是只读的，需要新增 PNG 写入端点
- 宝可梦正面精灵尺寸不固定: 40×40 / 48×48 / 56×56；背面统一 32×32
- 训练师肖像统一 56×56；NPC 精灵为 16×N 可变高度条带
- Tileset 是复合 tile 表（如 overworld.png = 128×48 = 72 个 8×8 tile），编辑瓦片需要提取子矩形后再合成

### Metis Review

**Identified Gaps** (addressed in plan):
- **架构不匹配**: 现有 Pinia store 模式基于 JSON 读写，像素编辑器需要 ImageData/Canvas 模型——计划中设计了独立的 `usePixelStore`，不依赖 JSON API
- **PNG 写入中间件不存在**: `/gfx/` 只读——Task 2 新增 PUT 端点
- **Tileset 复合编辑复杂度**: 不是简单编辑整个 PNG——Task 11 专门处理 tile 提取/合成
- **注册需要 9 个文件**: 不仅仅是 4 个——Task 4 覆盖全部注册点
- **PNG 实际是 2-bit 灰度**: 不是彩色 "white/light-gray/dark-gray/black"，而是灰度值 (0, 85, 170, 255)——调色板组件直接映射灰度
- **命名边界情况**: MrMime→mr.mime, fossil 精灵——Task 1 类型定义涵盖

---

## Work Objectives

### Core Objective
在 game-editor 中新增 "Pixel Editor" Activity，提供完整的像素级绘图能力，编辑 Pokemon 精灵、Tileset 瓦片、训练师肖像、NPC 精灵的 PNG 源文件，实现图形资产编辑器内闭环。

### Concrete Deliverables
- `src/types/pixel.ts` — 类型定义 + 资产索引
- `src/stores/pixelStore.ts` — Pinia pixel store
- `src/components/PixelEditor.vue` — 编辑器主组件
- `src/components/PixelSidebar.vue` — 资产浏览器侧边栏
- `src/composables/usePixelCanvas.ts` — Canvas 像素网格 + 缩放
- `src/composables/usePixelTools.ts` — 绘图工具逻辑
- `vite.config.ts` — 新增 PNG 读写中间件端点
- `src/router.ts`, `App.vue`, `ActivityBar.vue`, `StatusBar.vue` — 注册修改

### Definition of Done
- [ ] 用户可以通过 ActivityBar 进入 Pixel Editor
- [ ] 侧边栏可以浏览全部 4 类资产（按类别 + 搜索）
- [ ] 选中资产后，画布显示像素网格
- [ ] 铅笔/橡皮/取色器/填充 工具正常工作
- [ ] DMG 4 色调色板约束生效
- [ ] Ctrl+Z / Ctrl+Shift+Z 撤销/重做可用
- [ ] Ctrl+S 保存写回 PNG 文件
- [ ] 宝可梦精灵可以切换 front/back 帧预览
- [ ] Tileset 瓦片可以提取单个 8×8 tile 进行编辑
- [ ] 缩放控件可用（1x ~ 8x）

### Must Have
- 像素级绘制（pencil/eraser/eyedropper/fill）
- DMG 4 色硬约束调色板
- 撤销/重做（至少 50 步历史）
- 资产浏览器（按类别浏览全部图形资产）
- 缩放 1x-8x
- Ctrl+S 保存 PNG
- 多帧切换（宝可梦 front/back 互切）

### Must NOT Have (Guardrails)
- **不**修改 `.2bpp`/`.pic` 格式 —— 仅处理 PNG
- **不**支持多图层
- **不**支持画布尺寸调整
- **不**支持动画时间轴
- **不**引入外部图像编辑库（fabric.js/konva 等）—— 手写 Canvas 2D
- **不**修改现有 store/组件的内部逻辑（只追加新文件/端点）
- **不**覆盖 `gfx/tilesets_rg/` 或 `gfx/pokemon/front_rg/` 目录（版本变体不同步）
- **不**添加单元测试基础设施 —— 仅 QA Scenarios

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: NO
- **Automated tests**: None (QA Scenarios only)
- **Framework**: N/A

### QA Policy
Every task MUST include agent-executed QA scenarios. Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Frontend/UI**: Playwright — 打开浏览器，导航，交互，验证 DOM/Canvas
- **API**: Bash (curl) — 发送请求，验证响应状态和数据
- **TUI/CLI**: interactive_bash — 运行命令，验证输出

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — foundation + scaffolding):
├── Task 1: Type definitions + asset index [quick]
├── Task 2: Vite PNG read/write middleware [quick]
├── Task 3: Pinia pixel store [quick]
└── Task 4: Activity registration (router + ActivityBar + App.vue + StatusBar) [quick]

Wave 2 (After Wave 1 — core editing, MAX PARALLEL):
├── Task 5: Canvas pixel grid component [deep]
├── Task 6: Drawing tools (pencil, eraser, eyedropper, fill) [deep]
├── Task 7: DMG 4-color palette component [quick]
└── Task 8: Undo/redo system [quick]

Wave 3 (After Wave 2 — asset browser + integration):
├── Task 9: Asset browser sidebar [deep]
├── Task 10: Multi-frame preview (Pokemon front/back) [quick]
├── Task 11: Tileset tile extraction + editing [deep]
└── Task 12: PixelEditor.vue main integration [visual-engineering]

Wave 4 (After Wave 3 — polish + QA):
├── Task 13: Keyboard shortcuts + tool UI polish [visual-engineering]
└── Task 14: End-to-end QA verification [unspecified-high]

Wave FINAL (After ALL tasks — 4 parallel reviews):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)
```

Critical Path: Task 1 → Task 3 → Task 5 → Task 6 → Task 12 → Task 14 → F1-F4
Max Concurrent: 4 (Wave 2 & Wave 3)

---

## TODOs

- [x] 1. Type definitions + asset index (`src/types/pixel.ts`)

  **What to do**:
  - Create `src/types/pixel.ts` with all pixel editor type definitions:
    - `AssetCategory`: `'pokemon' | 'tileset' | 'trainer' | 'overworld'`
    - `AssetEntry`: `{ name: string; path: string; category: AssetCategory; width: number; height: number; frames?: string[] }`
    - `DrawTool`: `'pencil' | 'eraser' | 'eyedropper' | 'fill'`
    - `DMG_COLORS`: `[0xFFFFFF, 0xAAAAAA, 0x555555, 0x000000]` (white, light gray, dark gray, black)
    - `PixelHistoryEntry`: `{ imageData: ImageData }` for undo/redo stack
    - `TilesetTileMeta`: `{ tilesetName: string; tileIndex: number; x: number; y: number }` — position of an 8×8 tile within tileset sheet
  - Build asset index — hardcoded map of all known assets:
    - Loop over 153 front sprites + 151 back sprites from `gfx/pokemon/front/` and `gfx/pokemon/back/`
    - Include the `speciesToSpriteName()` mapping from `src/types/pokemon.ts` for MrMime special case
    - 45 trainer portraits from `gfx/trainers/`
    - 67 NPC sprites from `gfx/sprites/`
    - 19 tilesets from `gfx/tilesets/` with tile dimensions (width/8 × height/8 tiles)
  - Export helper functions:
    - `getAssetUrl(entry: AssetEntry): string` — returns `/gfx/pokemon/front/bulbasaur.png` style URL
    - `getTilesetAssetEntries(): AssetEntry[]` — returns all tilesets with tile count metadata
  - These are all constants, no runtime fetching needed — PNGs loaded on demand

  **Must NOT do**:
  - Don't include `front_rg/` variants (Red palette variants should not be synced)
  - Don't include `.2bpp`/`.pic`/`.bst` files — PNG only
  - Don't dynamically scan directories at runtime — use hardcoded asset lists for predictable behavior

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single file, well-defined constants and types, no complex logic
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None needed

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 2, Task 4)
  - **Parallel Group**: Wave 1 (with Tasks 2, 4)
  - **Blocks**: Task 3, Task 5, Task 6, Task 9
  - **Blocked By**: None (can start immediately)

  **References**:
  - `src/types/pokemon.ts:47-56` — `speciesToSpriteName()` function: copy/import this for MrMime→`mr.mime` mapping
  - `src/types/constants.ts:1-30` — existing constant patterns (TILE_SIZE, BLOCK_TILES, etc.) — follow same style
  - `src/types/index.ts:1-30` — existing type definition patterns: interfaces, type aliases, constants
  - `vite.config.ts:8` — `gfxRoot` path constant: use same pattern for asset path resolution

  **Acceptance Criteria**:
  - [ ] TypeScript compiles without errors: `npx vue-tsc --noEmit` passes with new file
  - [ ] All 4 categories have entries in the asset index
  - [ ] `getAssetUrl()` returns correct paths matching existing `/gfx/` middleware routes

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Asset index completeness check
    Tool: interactive_bash (npm run dev + curl)
    Preconditions: Game editor dev server running (npm run dev)
    Steps:
      1. In browser console (or via component test), import and execute the asset index functions
      2. Assert getAssetUrl for pokemon category returns paths like '/gfx/pokemon/front/bulbasaur.png'
      3. Assert getAssetUrl for 'MrMime' returns '/gfx/pokemon/front/mr.mime.png' (dot preserved)
      4. Assert tileset entries include 'overworld', 'cavern', 'house' etc.
      5. Count pokemon front entries ≥ 151, back entries ≥ 151, trainers = 45, tilesets = 19
    Expected Result: All asset counts match, all URLs are valid relative paths
    Failure Indicators: Wrong counts, broken URLs, MrMime wrong path
    Evidence: .sisyphus/evidence/task-1-asset-index.txt
  ```

  **Evidence to Capture**:
  - [ ] Console output showing asset counts per category

  **Commit**: YES (Wave 1 group)
  - Message: `feat(pixel): add pixel editor foundation — types, middleware, store, activity registration`
  - Files: `src/types/pixel.ts`

- [x] 2. Vite PNG read/write middleware (`vite.config.ts`)

  **What to do**:
  - Add PNG write middleware to `vite.config.ts` (no existing PUT endpoint for images):
    - New route: `PUT /gfx/pokemon/front/:name.png` → write raw body to `gfxRoot/pokemon/front/:name.png`
    - Same pattern for `/gfx/pokemon/back/:name.png`, `/gfx/trainers/:name.png`, `/gfx/sprites/:name.png`
    - For tilesets: `PUT /gfx/tilesets/:name.png` → write to `gfxRoot/tilesets/:name.png`
    - For tileset tile editing (composite sheet): `PUT /gfx/tilesets/:name/tile/:index.png` — this endpoint extracts a single 8×8 tile and later recomposites it. For Wave 1, just add the endpoint skeleton; the actual extraction logic goes in Task 11.
  - Middleware implementation:
    - Listen on `/gfx/*` path with PUT method
    - Collect raw body chunks (Buffer) → `Buffer.concat()`
    - Validate: body is non-empty, Content-Type is `image/png`
    - Write: `fs.writeFileSync(resolvedPath, buffer)`
    - Return: 200 OK or 400/500 on error
  - Ensure the middleware is placed AFTER the existing static serve middleware (GET should still work for serving)
  - Add proper CORS headers for PUT: `Access-Control-Allow-Methods: GET, PUT`
  - Log successful saves to console for developer feedback

  **Must NOT do**:
  - Don't break existing GET `/gfx/*` serving — the new PUT handler must coexist with static serving
  - Don't write outside `gfxRoot` — validate path doesn't escape (path traversal protection)
  - Don't overwrite `front_rg/` or `tilesets_rg/` variants

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single file modification, well-defined Node.js middleware pattern, follows existing conventions
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None needed

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 1, Task 4)
  - **Parallel Group**: Wave 1 (with Tasks 1, 4)
  - **Blocks**: Task 3 (store needs the PUT endpoint for save), Task 12
  - **Blocked By**: None (can start immediately)

  **References**:
  - `vite.config.ts:1-50` — existing middleware pattern: `server.middlewares.use()` with path matching and fs read/write
  - `vite.config.ts:8` — `gfxRoot = path.resolve(__dirname, '../../../gfx')` — use this path constant
  - `vite.config.ts:500-550` — existing PUT handlers for JSON (e.g., `/api/pokemon/:species`) — follow same pattern but for binary
  - `vite.config.ts:150-200` — existing GET `/gfx/*` static serve middleware — PUT must NOT interfere with this

  **Acceptance Criteria**:
  - [ ] `curl -X PUT http://localhost:5173/gfx/pokemon/front/bulbasaur.png --data-binary @test.png` returns 200
  - [ ] After PUT, `curl http://localhost:5173/gfx/pokemon/front/bulbasaur.png` returns the new content
  - [ ] Path traversal attempt (e.g., `../../../etc/passwd`) returns 400
  - [ ] Existing GET `/gfx/*` still serves files normally

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Happy path — save and re-read a PNG
    Tool: Bash (curl)
    Preconditions: Dev server running, test PNG file exists
    Steps:
      1. cp gfx/pokemon/front/bulbasaur.png /tmp/test-bulbasaur-backup.png
      2. curl -X PUT http://localhost:5173/gfx/pokemon/front/bulbasaur.png \
           --data-binary @/tmp/test-pixel.png -H "Content-Type: image/png"
      3. Assert HTTP 200 OK
      4. curl http://localhost:5173/gfx/pokemon/front/bulbasaur.png -o /tmp/verify.png
      5. diff /tmp/test-pixel.png /tmp/verify.png → no diff (identical)
      6. cp /tmp/test-bulbasaur-backup.png gfx/pokemon/front/bulbasaur.png  # restore
    Expected Result: File written and re-read matches original upload
    Failure Indicators: Non-200 status, file not updated, diff shows difference
    Evidence: .sisyphus/evidence/task-2-png-write.txt

  Scenario: Path traversal protection
    Tool: Bash (curl)
    Preconditions: Dev server running
    Steps:
      1. curl -X PUT "http://localhost:5173/gfx/../../../etc/hostile.png" \
           --data-binary @test.png -H "Content-Type: image/png"
      2. Assert HTTP 400 Bad Request
      3. curl -X PUT "http://localhost:5173/gfx/pokemon/front/../../evil.png" \
           --data-binary @test.png -H "Content-Type: image/png"
      4. Assert HTTP 400 Bad Request
    Expected Result: Both requests rejected with 400
    Failure Indicators: 200 OK on traversal attempt, file written outside gfxRoot
    Evidence: .sisyphus/evidence/task-2-path-traversal.txt
  ```

  **Evidence to Capture**:
  - [ ] curl output showing PUT success and GET verification
  - [ ] curl output showing path traversal rejection

  **Commit**: YES (Wave 1 group)
  - Message: `feat(pixel): add pixel editor foundation — types, middleware, store, activity registration`
  - Files: `vite.config.ts`

- [x] 3. Pinia pixel store (`src/stores/pixelStore.ts`)

  **What to do**:
  - Create `src/stores/pixelStore.ts` — fundamentally different from existing stores (which are JSON-based). This store manages canvas pixel data, not typed JSON objects.
  - State:
    - `activeAsset: AssetEntry | null` — currently loaded asset
    - `imageData: ImageData | null` — raw pixel buffer of the loaded image (RGBA)
    - `canvasWidth: number` / `canvasHeight: number` — dimensions of current image
    - `activeTool: DrawTool` — `'pencil'` by default
    - `activeColorIndex: number` — 0-3 index into DMG_COLORS (default 3 = black)
    - `zoom: number` — 1-8 (default 4)
    - `showGrid: boolean` — pixel grid overlay toggle
    - `undoStack: PixelHistoryEntry[]` — max 50 entries
    - `redoStack: PixelHistoryEntry[]`
    - `isDirty: boolean` — true if unsaved changes exist
    - `activeFrame: number` — 0 = front, 1 = back (for Pokemon sprites)
    - `isTilesetMode: boolean` — true when editing a single tile extracted from a tileset
    - `tilesetMeta: TilesetTileMeta | null` — current tile position within tileset sheet
  - Actions:
    - `loadAsset(entry: AssetEntry)` — fetch PNG via `fetch()`, decode to ImageData, push initial state to undo stack
    - `drawPixel(x: number, y: number)` — set pixel at (x,y) to activeColorIndex's DMG_COLOR value; push history before change
    - `erasePixel(x: number, y: number)` — set pixel to index 0 (white/transparent)
    - `fillAt(x: number, y: number)` — flood fill from (x,y) with activeColorIndex
    - `pickColor(x: number, y: number)` — set activeColorIndex to the DMG_COLOR closest to pixel at (x,y)
    - `undo()` — pop from undoStack, push current to redoStack, restore previous ImageData
    - `redo()` — pop from redoStack, push current to undoStack, restore next ImageData
    - `save()` — PUT PNG binary to `/gfx/:category/:name.png` via `fetch()` with `arrayBuffer()`
    - `switchFrame(index: number)` — load the alternate frame (front↔back for Pokemon)
    - `loadTilesetTile(tilesetName: string, tileIndex: number)` — for tileset mode: extract 8×8 sub-rectangle from tileset PNG
    - `saveTilesetTile()` — recomposite the edited 8×8 tile back into the tileset PNG and save
  - Getters:
    - `canUndo: boolean` — undoStack.length > 0
    - `canRedo: boolean` — redoStack.length > 0
    - `dmgPalette(): string[]` — returns DMG_COLORS as CSS hex strings
    - `activeFrames(): AssetEntry[]` — returns list of related frames for current asset
  - ImageData → PNG conversion for save: use a small offscreen canvas → `canvas.toBlob('image/png')` → `blob.arrayBuffer()` → PUT
  - PNG → ImageData for load: use `new Image()` → draw on offscreen canvas → `ctx.getImageData()`

  **Must NOT do**:
  - Don't use the JSON-based API middleware pattern — this store reads/writes binary PNGs directly
  - Don't store full ImageData in every history entry (memory concern) — but for MVP simplicity, store full ImageData (each 56×56 = ~12KB, 50 steps = ~600KB, which is acceptable)
  - Don't auto-save — require explicit Ctrl+S / save button

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Core architectural component — fundamentally different from existing stores (binary vs JSON), handles ImageData state management, undo/redo stack, PNG encode/decode, tileset tile extraction/recomposition. Needs careful thought about state shape and edge cases.
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None needed

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Task 1 for types)
  - **Parallel Group**: Wave 1 (with Task 4)
  - **Blocks**: Task 5, Task 6, Task 7, Task 8, Task 9, Task 10, Task 11, Task 12
  - **Blocked By**: Task 1 (types)

  **References**:
  - `src/stores/mapStore.ts:1-50` — existing Pinia store pattern: `defineStore`, state typing, actions pattern
  - `src/stores/layoutStore.ts:1-50` — another store with undo/redo pattern: history stack, canUndo/canRedo, commitChange
  - `src/types/pokemon.ts:47-56` — `speciesToSpriteName()` — needed for frame switching logic
  - `vite.config.ts:8` — `gfxRoot` path: used to construct PUT URLs

  **Acceptance Criteria**:
  - [ ] Store initializes with default state (no active asset)
  - [ ] `loadAsset()` fetches PNG and decodes to correct ImageData dimensions
  - [ ] `drawPixel()` correctly updates RGBA values for the target pixel
  - [ ] `fillAt()` flood-fills connected region with same color
  - [ ] `undo()` / `redo()` correctly restore previous/next states
  - [ ] Undo stack capped at 50 entries (oldest dropped)
  - [ ] `save()` sends correct PNG binary via PUT

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Load and save a Pokemon sprite
    Tool: Playwright
    Preconditions: Dev server running, navigate to /#/pixel
    Steps:
      1. Via Playwright page.evaluate(), access the pixel store
      2. Call store.loadAsset with a pokemon asset entry (Bulbasaur front)
      3. Assert store.imageData is not null and has correct dimensions (56×56 or 40×40)
      4. Call store.drawPixel(10, 10) — should change pixel at (10,10) to active color
      5. Assert store.isDirty is true
      6. Assert store.canUndo is true
      7. Call store.undo() — pixel should revert
      8. Assert store.isDirty is false
    Expected Result: Load works, draw changes pixel, undo restores it
    Failure Indicators: null imageData, wrong dimensions, draw doesn't change data, undo doesn't work
    Evidence: .sisyphus/evidence/task-3-store-load-draw-undo.json
  ```

  **Evidence to Capture**:
  - [ ] Playwright evaluation results showing store state at each step

  **Commit**: YES (Wave 1 group)
  - Message: `feat(pixel): add pixel editor foundation — types, middleware, store, activity registration`
  - Files: `src/stores/pixelStore.ts`

- [x] 4. Activity registration (router + ActivityBar + App.vue + StatusBar)

  **What to do**:
  - Register "pixel" as the 8th activity across all registration points:
    1. **`src/router.ts`**: Add route `{ path: '/pixel/:asset?', name: 'pixel', component: App, props: ... }` following the existing pattern for trainer/pokemon/move/layout
    2. **`src/components/ActivityBar.vue`**: Add `{ id: 'pixel', icon: '🖼', label: 'Pixel Editor' }` to the items array; add `'pixel'` to the `Activity` type union
    3. **`src/App.vue`**: 
       - Import `usePixelStore` from `./stores/pixelStore`
       - Add `'pixel'` to the `Activity` type union (line 64)
       - Add `watch(activeActivity, ...)` handling for pixel → route sync
       - Add `watch(() => route.fullPath, ...)` handling for URL → pixel activity sync
       - Add sidebar rendering: `<PixelSidebar v-else-if="activeActivity === 'pixel'" />` in the sidebar div
       - Add main area rendering: `<PixelEditor v-else-if="activeActivity === 'pixel'" />` 
       - Add URL parameter handling for `/pixel/:asset`
    4. **`src/components/StatusBar.vue`**: Add `'pixel'` to the `Activity` type union (line 6); add pixel-specific rightText (e.g., zoom level)
  - Pattern: Copy the `layout` activity's registration pattern exactly — it's the most recent and cleanest addition

  **Must NOT do**:
  - Don't modify the internal logic of existing activity handlers — only add new branches
  - Don't remove or rename existing routes/activities
  - Don't add the import if the PixelEditor/PixelSidebar components don't exist yet — create stub components first (minimal `<template><div>Pixel Editor</div></template>`) to avoid import errors

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Mechanical registration across 4 files following well-established patterns. No complex logic — just adding entries to arrays and union types.
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None needed

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 1, Task 2)
  - **Parallel Group**: Wave 1 (with Tasks 1, 2)
  - **Blocks**: Task 12 (needs routes and activity wiring to exist)
  - **Blocked By**: Task 3 (needs store import to exist in App.vue)

  **References**:
  - `src/router.ts:53-62` — layout route pattern: copy the `path: '/layout/:name?'` pattern for pixel
  - `src/components/ActivityBar.vue:12-20` — items array: add entry after layout (line 19)
  - `src/App.vue:64` — Activity type union: add `'pixel'`
  - `src/App.vue:98-106` — layout activity routing: copy the watch patterns for pixel
  - `src/App.vue:331-334` — layout sidebar rendering: copy pattern for pixel
  - `src/App.vue:587` — layout editor rendering: copy pattern for pixel
  - `src/components/StatusBar.vue:6` — Activity type: add `'pixel'`
  - `src/components/StatusBar.vue:26-29` — rightText logic: add branch for pixel showing zoom

  **Acceptance Criteria**:
  - [ ] Navigating to `/#/pixel` renders the Pixel Editor stub (no 404)
  - [ ] Pixel icon appears in ActivityBar (8th button, after Layout)
  - [ ] Clicking Pixel icon sets activeActivity to 'pixel'
  - [ ] URL updates to `/#/pixel` when Pixel activity is active
  - [ ] StatusBar shows pixel-specific info when active
  - [ ] `npx vue-tsc --noEmit` passes (no type errors from new imports)

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Activity navigation and URL sync
    Tool: Playwright
    Preconditions: Dev server running (npm run dev)
    Steps:
      1. Navigate to http://localhost:5173/#/pixel
      2. Assert page contains "Pixel Editor" text (from stub component)
      3. Assert ActivityBar shows pixel icon as active (has .active class)
      4. Click "Map Editor" icon in ActivityBar
      5. Assert URL changes to /#/map
      6. Navigate back to /#/pixel
      7. Assert pixel icon is active again
    Expected Result: Navigation works bidirectionally, URL and activity stay in sync
    Failure Indicators: 404 page, wrong active icon, URL doesn't match activity
    Evidence: .sisyphus/evidence/task-4-activity-nav.png
  ```

  **Evidence to Capture**:
  - [ ] Screenshot of Pixel Editor activity with active icon

  **Commit**: YES (Wave 1 group)
  - Message: `feat(pixel): add pixel editor foundation — types, middleware, store, activity registration`
  - Files: `src/router.ts`, `src/components/ActivityBar.vue`, `src/App.vue`, `src/components/StatusBar.vue`, `src/components/PixelEditor.vue` (stub), `src/components/PixelSidebar.vue` (stub)

- [x] 5. Canvas pixel grid component (`src/composables/usePixelCanvas.ts` + component)
- [x] 6. Drawing tools — pencil, eraser, eyedropper, fill (`src/composables/usePixelTools.ts`)
- [x] 7. DMG 4-color palette component (`src/components/PaletteSelector.vue`)
- [x] 8. Undo/redo system (integrated into store + UI buttons)

  **What to do**:
  - The undo/redo state management is already in the PixelStore (Task 3). This task adds the UI and keyboard integration:
    - Add undo/redo buttons to the Pixel Editor toolbar:
      - ↩ Undo button (disabled when `!store.canUndo`)
      - ↪ Redo button (disabled when `!store.canRedo`)
      - Show history depth indicator: "Step 5/50" or similar
    - Keyboard shortcuts (in the keyboard handler composable):
      - `Ctrl+Z` / `Cmd+Z` → `store.undo()`
      - `Ctrl+Shift+Z` / `Cmd+Shift+Z` → `store.redo()`
      - Prevent default browser undo/redo when canvas is focused
    - History stack behavior (in store):
      - When user starts drawing (first pixel of a stroke), push current ImageData to undo stack
      - Subsequent pixels in the same stroke don't push (stroke = all pixels between mousedown and mouseup)
      - This means "undo" undoes an entire stroke, not individual pixels
      - For fill and eyedropper: push before the operation
      - Max 50 entries — when full, drop oldest entry
      - Clear redo stack when new action is taken after an undo
    - Visual feedback: brief flash or subtle animation when undo/redo completes

  **Must NOT do**:
  - Don't push history on every single pixel (performance nightmare) — batch by stroke
  - Don't allow undo beyond stack depth (disable button when canUndo=false)
  - Don't leak memory — ensure old ImageData entries are garbage collected

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Store already has undo/redo state (Task 3). This task adds UI buttons + keyboard shortcuts + stroke batching. Mostly plumbing.
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None needed

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 6, Task 7)
  - **Parallel Group**: Wave 2 (with Tasks 6, 7)
  - **Blocks**: Task 12
  - **Blocked By**: Task 3 (store with undo/redo methods)

  **References**:
  - `src/stores/layoutStore.ts` — existing undo/redo pattern: history stack, historyIndex, undo()/redo() actions
  - `src/stores/pixelStore.ts` — store.undo(), store.redo(), canUndo, canRedo

  **Acceptance Criteria**:
  - [ ] Undo button undoes last stroke (all pixels from one mousedown→mouseup)
  - [ ] Redo button redoes last undone stroke
  - [ ] Ctrl+Z and Ctrl+Shift+Z work as expected
  - [ ] Buttons disabled when no history available
  - [ ] New action after undo clears redo stack

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Undo/redo a drawing stroke
    Tool: Playwright
    Preconditions: Sprite loaded, pencil selected
    Steps:
      1. Draw a 5-pixel horizontal line (mousedown at (10,10), drag to (14,10), mouseup)
      2. Press Ctrl+Z → entire 5-pixel stroke should be undone
      3. Assert store.canUndo is true (one more history entry: initial state)
      4. Assert store.canRedo is true
      5. Press Ctrl+Shift+Z → 5-pixel stroke should be redrawn
      6. Assert store.canRedo is false
    Expected Result: Undo removes entire stroke, redo restores it
    Failure Indicators: Only one pixel undone, redo doesn't work, canRedo false when should be true
    Evidence: .sisyphus/evidence/task-8-undo-redo.png
  ```

  **Evidence to Capture**:
  - [ ] Screenshots showing before/after undo/redo

  **Commit**: YES (Wave 2 group)
  - Message: `feat(pixel): add canvas grid, drawing tools, palette, undo/redo`
  - Files: `src/components/PixelEditorToolbar.vue` (or inline in PixelEditor.vue)

- [x] 9. Asset browser sidebar (`src/components/PixelSidebar.vue`)
- [x] 10. Multi-frame preview for Pokemon sprites
- [x] 11. Tileset tile extraction + editing mode

  **What to do**:
  - Add tileset-specific editing mode to the pixel editor:
    - **Tileset tile listing**: When a tileset asset is selected in the sidebar, instead of loading the full tileset image, show a list/grid of individual tiles
      - Each tile is an 8×8 pixel sub-rectangle of the tileset sheet
      - Tiles are numbered (0, 1, 2, ...) and shown as small thumbnails (32×32 zoomed preview)
      - Clicking a tile enters "tile edit mode"
    - **Tile extraction** (`pixelStore.loadTilesetTile(tilesetName, tileIndex)`):
      - Load the full tileset PNG
      - Calculate the 8×8 sub-rectangle position: `tileX = (tileIndex % cols) * 8`, `tileY = floor(tileIndex / cols) * 8`
      - Where `cols = tilesetWidth / 8` (typically 16 for 128px-wide tilesets)
      - Extract the 8×8 pixels as ImageData
      - Store `tilesetMeta: { tilesetName, tileIndex, tileX, tileY }` for recomposition
    - **Tile recomposition** (`pixelStore.saveTilesetTile()`):
      - Reload the full tileset PNG
      - Paste the edited 8×8 ImageData back into the correct position
      - Save the full tileset PNG via PUT `/gfx/tilesets/:name.png`
    - **Visual cues**: Show "Tileset Mode" indicator in toolbar; show tile index and position
    - Tileset dimensions: read from tileset PNG (e.g., overworld.png = 128×48 → 16×6 = 96 tiles)

  **Must NOT do**:
  - Don't edit tiles at arbitrary positions — only at the extracted tile's position
  - Don't allow drawing outside the 8×8 tile boundary in tileset mode
  - Don't modify the tileset's color palette — tilesets use 4-color DMG too
  - Don't recomposite until explicit save — allow editing without modifying the original

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Complex feature — tileset sheet parsing, 8×8 sub-rectangle extraction, recomposition logic, tile grid UI, boundary enforcement. Requires careful coordinate math and integration with the existing render path.
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None needed

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 9, Task 10)
  - **Parallel Group**: Wave 3 (with Tasks 9, 10)
  - **Blocks**: Task 12
  - **Blocked By**: Task 5 (canvas), Task 9 (sidebar)

  **References**:
  - `src/composables/renderTiles.ts:1-50` — existing tile rendering from tileset: drawImage with source rect for 8×8 tiles. This is the inverse operation — reading tile pixels from tileset instead of drawing them.
  - `src/stores/mapStore.ts:1-50` — tileset image loading and block data patterns
  - `vite.config.ts:27-50` — TILESET_BST_FILES map: shows tileset naming conventions
  - `src/types/pixel.ts` — TilesetTileMeta type

  **Acceptance Criteria**:
  - [ ] Selecting a tileset shows tile grid (not full image)
  - [ ] Clicking a tile extracts correct 8×8 sub-rectangle
  - [ ] Editing is constrained to 8×8 canvas
  - [ ] Save recomposites tile into tileset PNG correctly
  - [ ] Original tileset is not modified until explicit save

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Extract, edit, and save a tileset tile
    Tool: Playwright
    Preconditions: Dev server running, navigate to /#/pixel
    Steps:
      1. Click "Tilesets" tab in sidebar
      2. Click "Overworld" tileset entry → tile grid appears (e.g., 96 tiles)
      3. Click tile #0 (top-left, should be the first 8×8 tile)
      4. Assert canvas is 8×8, showing only that tile's pixels
      5. Draw on the tile (change a few pixels)
      6. Press Ctrl+S to save
      7. Verify the tileset file was updated: reload and check tile #0 has the changes
      8. Assert "Tileset Mode" indicator is shown in toolbar
    Expected Result: Tile extraction and recomposition works correctly
    Failure Indicators: Wrong tile extracted, save corrupts tileset, canvas not constrained to 8×8
    Evidence: .sisyphus/evidence/task-11-tileset-tile.png
  ```

  **Evidence to Capture**:
  - [ ] Screenshots: tile grid view, individual tile editing, before/after save

  **Commit**: YES (Wave 3 group)
  - Message: `feat(pixel): add asset browser, frame preview, tileset mode, editor integration`
  - Files: `src/components/PixelSidebar.vue`, `src/stores/pixelStore.ts`, `src/components/TileGrid.vue` (new component for tile listing)

- [x] 12. PixelEditor.vue — main integration component

  **What to do**:
  - Refactor the stub `PixelEditor.vue` into the full integration component that wires everything together:
    - **Layout**: Three-column layout
      - Left (or floating): Palette selector (PaletteSelector.vue)
      - Center: Canvas (pixel canvas with grid)
      - Right (or top bar): Toolbar (tool buttons + undo/redo + zoom + save)
    - **Toolbar**:
      - Tool buttons: Pencil (✏), Eraser (🧹), Eyedropper (💉), Fill (🪣)
      - Active tool has highlighted style (`.active` class, accent border)
      - Zoom controls: `-` / `+` buttons + current zoom display (e.g., "4x")
      - Grid toggle: checkbox or button for showGrid
      - Undo / Redo buttons with disabled state
      - Save button (💾) with dirty indicator
      - Frame indicator ("Front" / "Back" for Pokemon, "Tile #12" for tilesets)
    - **Canvas area**: 
      - Centered in available space with scroll overflow
      - Canvas element managed by usePixelCanvas composable
      - Dark background behind canvas (matching the editor's dark theme #1a1a2e)
    - **Integration points**:
      - Import and instantiate `usePixelStore` (Pinia)
      - Import and use `usePixelCanvas` composable
      - Import and use `usePixelTools` composable
      - Wire event handlers: canvas mousedown/mousemove/mouseup → tools
      - Wire keyboard handlers: tool shortcuts, color shortcuts, Ctrl+Z, Ctrl+S
      - Watch `store.activeAsset` to update canvas
    - Handle empty state: when no asset is loaded, show a placeholder message: "Select an asset from the sidebar to begin editing"
    - Handle loading state: show a brief loading indicator while PNG is being fetched

  **Must NOT do**:
  - Don't show raw JSON or debug info in the editor UI
  - Don't use inline styles — use TailwindCSS classes (consistent with the rest of the editor)
  - Don't hardcode dimensions — read from store.canvasWidth/canvasHeight

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: UX integration component — needs to compose palette, canvas, toolbar, and sidebar into a cohesive layout following the editor's dark theme. Visual polish, empty states, loading states.
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None needed

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on all Wave 2 and Wave 3 components)
  - **Parallel Group**: Wave 3 (last task)
  - **Blocks**: Task 13, Task 14
  - **Blocked By**: Tasks 5, 6, 7, 8, 9, 10, 11

  **References**:
  - `src/components/LayoutEditor.vue:1-100` — existing editor component with toolbar + canvas + sidebar layout pattern
  - `src/components/MapCanvas.vue:1-50` — existing canvas wrapper with zoom controls
  - `src/components/EditorToolbar.vue:1-50` — existing toolbar with tool buttons and zoom
  - `src/App.vue:296-608` — activity layout pattern (sidebar + main area)
  - `src/style.css:1-30` — CSS custom properties: --color-bg (#1a1a2e), --color-accent (#4ecca3), --color-bg-inset, etc.

  **Acceptance Criteria**:
  - [ ] Empty state shows placeholder message when no asset loaded
  - [ ] Loading asset shows canvas with pixel grid
  - [ ] Tool buttons switch active tool with visual feedback
  - [ ] Zoom controls change canvas scale
  - [ ] Save button triggers PNG write
  - [ ] Undo/redo buttons work with disabled states
  - [ ] Palette selector is visible and functional
  - [ ] Frame/tile indicator shows current mode

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Full workflow — load, edit, save a Pokemon sprite
    Tool: Playwright
    Preconditions: Dev server running
    Steps:
      1. Navigate to http://localhost:5173/#/pixel
      2. Assert placeholder message is visible ("Select an asset...")
      3. In sidebar, select Pokemon → search "pikachu" → click Pikachu
      4. Assert canvas loads Pikachu front sprite
      5. Select pencil tool, select black color
      6. Draw on canvas (click at position corresponding to pixel center)
      7. Assert pixel changes to black on canvas
      8. Press Ctrl+Z → pixel reverts
      9. Press Ctrl+Shift+Z → pixel reappears
      10. Press Ctrl+S → save indicator appears briefly
      11. Verify the file was saved: reload the page and assert the pixel is still black
    Expected Result: Complete edit-save cycle works end-to-end
    Failure Indicators: Canvas doesn't load, tools don't work, save doesn't persist
    Evidence: .sisyphus/evidence/task-12-full-workflow.png
  ```

  **Evidence to Capture**:
  - [ ] Screenshot of full editor layout with loaded sprite
  - [ ] Before/after edit comparison

  **Commit**: YES (Wave 3 group)
  - Message: `feat(pixel): add asset browser, frame preview, tileset mode, editor integration`
  - Files: `src/components/PixelEditor.vue`

- [x] 13. Keyboard shortcuts + tool UI polish

  **What to do**:
  - Add a comprehensive keyboard shortcut system:
    - Tool shortcuts: `B`/`P` → Pencil, `E` → Eraser, `I` → Eyedropper, `G` → Fill
    - Color shortcuts: `1`-`4` → DMG color indices 0-3
    - Edit shortcuts: `Ctrl+Z` undo, `Ctrl+Shift+Z` redo, `Ctrl+S` save
    - View shortcuts: `+`/`=` zoom in, `-` zoom out, `0` reset zoom to 4x, `G` toggle grid
    - All shortcuts active when canvas is focused; `Ctrl+S` always active
  - Add a keyboard shortcut help panel:
    - `?` key opens a small modal/overlay listing all shortcuts
    - Dark themed, dismiss on Escape or click outside
  - Tool UI polish:
    - Tool buttons show keyboard shortcut hint as tooltip (e.g., "Pencil (B)")
    - Cursor changes to crosshair when hovering canvas
    - During eyedropper, cursor shows a small magnifying glass or preview of the color
    - Brush size indicator (1px square following cursor) when pencil/eraser active
  - Save UX polish:
    - Show brief "Saved ✓" toast notification after successful save (auto-dismiss 2s)
    - Show "Save failed" toast on error
    - Disable save button when not dirty
  - Dirty state handling:
    - Show `*` in title or "Unsaved changes" indicator
    - Confirm before navigating away with unsaved changes (`beforeunload` or route guard)

  **Must NOT do**:
  - Don't add a full settings/preferences panel — keep it minimal
  - Don't override browser shortcuts globally — only when canvas is focused
  - Don't add complex animation/transition effects

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: UI polish, keyboard UX, toast notifications, tooltips, visual feedback. Design-focused with light logic.
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None needed

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Task 12)
  - **Parallel Group**: Wave 4 (with Task 14)
  - **Blocks**: None (final wave)
  - **Blocked By**: Task 12 (needs editor component to exist)

  **References**:
  - `src/components/EditorToolbar.vue` — existing toolbar with tool buttons and zoom, tooltip patterns
  - `src/components/LayoutEditor.vue:1-50` — existing keyboard shortcut handling (Ctrl+S, etc.)
  - `src/App.vue:1-50` — existing dirty state detection pattern

  **Acceptance Criteria**:
  - [ ] All keyboard shortcuts work when canvas is focused
  - [ ] `?` key opens shortcut help modal
  - [ ] Tool buttons show shortcut hints
  - [ ] Save toast appears on successful save
  - [ ] Unsaved changes indicator shown when dirty
  - [ ] Navigation guard warns before leaving with unsaved changes

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Keyboard shortcuts work correctly
    Tool: Playwright
    Preconditions: Sprite loaded, canvas focused
    Steps:
      1. Press 'E' → assert eraser tool selected
      2. Press 'B' → assert pencil tool selected
      3. Press '3' → assert color index 2 (dark gray) selected
      4. Press '?' → assert shortcut help modal appears
      5. Press Escape → assert modal dismisses
      6. Make a change → press Ctrl+S → assert save toast appears
    Expected Result: All shortcuts trigger correct actions
    Failure Indicators: Shortcut doesn't work, wrong tool selected, modal doesn't appear
    Evidence: .sisyphus/evidence/task-13-shortcuts.png
  ```

  **Evidence to Capture**:
  - [ ] Screenshot of shortcut help modal
  - [ ] Screenshot of save toast notification

  **Commit**: YES (Wave 4 group)
  - Message: `feat(pixel): add keyboard shortcuts, tool polish, QA verification`
  - Files: `src/components/PixelEditor.vue`, `src/composables/usePixelTools.ts`

- [x] 14. End-to-end QA verification

  **What to do**:
  - Run a comprehensive QA pass over the entire Pixel Editor:
    1. **Asset browser QA**:
       - Verify all 4 categories show correct counts (Pokemon: 151+ species, Trainers: 45, Overworld: 67, Tilesets: 19)
       - Verify search filtering works for each category
       - Verify thumbnails render for all visible items
    2. **Pokemon editing QA**:
       - Load Bulbasaur, Pikachu, Mewtwo (different sizes: 56×56, 56×56, 40×40)
       - Draw on each, save, reload, verify persistence
       - Switch frames (front↔back), verify each loads correctly
       - Test special case: MrMime (dot in filename)
    3. **Trainer portrait QA**:
       - Load Brock, edit pixels, save, reload, verify
    4. **Overworld sprite QA**:
       - Load a 16×N strip sprite, edit, save, verify
    5. **Tileset tile QA**:
       - Extract tile #0 from overworld.png, edit, save
       - Reload and verify tile change is visible in tile grid
       - Verify tileset PNG is not corrupted (all other tiles intact)
    6. **Tool testing**:
       - Test all 4 tools on various sprite sizes
       - Test flood fill on complex shapes
       - Test eyedropper accuracy on all 4 DMG colors
    7. **Edge cases**:
       - Rapid tool switching (no crash)
       - Save with no changes (no unnecessary file write)
       - Undo past history limit (50 steps)
       - Zoom in/out while drawing (no state loss)
       - Resize browser window (canvas should stay centered)
    8. **Cross-activity check**:
       - Switch from Map Editor to Pixel Editor and back
       - Verify no state leakage between activities
    9. **Type check**:
       - `npx vue-tsc --noEmit` passes with zero errors
    10. **File integrity**:
        - After editing and saving a PNG, verify the file is still a valid PNG (can be opened by image viewer)
        - Verify the PNG dimensions match original (no size change)
  - Document any issues found as follow-up tasks

  **Must NOT do**:
  - Don't modify any source files in this task — this is verification only
  - Don't add new features or fix bugs found — document them instead

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Comprehensive manual QA — needs to run through all 4 asset categories × all 4 tools × edge cases. Systematic verification following a checklist.
  - **Skills**: [`playwright`]
    - `playwright`: Browser automation for all UI tests, canvas interaction, screenshots

  **Parallelization**:
  - **Can Run In Parallel**: NO (final task, runs after all implementation)
  - **Parallel Group**: Wave 4 (final)
  - **Blocks**: FINAL verification wave
  - **Blocked By**: Task 13

  **References**:
  - `.sisyphus/plans/pixel-editor.md` — this entire plan: use Acceptance Criteria from all tasks as QA checklist
  - `src/types/pixel.ts` — asset index for verifying counts

  **Acceptance Criteria**:
  - [ ] All 10 QA categories pass
  - [ ] All evidence screenshots saved to `.sisyphus/evidence/task-14/`
  - [ ] `npx vue-tsc --noEmit` passes
  - [ ] No crash or data loss scenarios found

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Full end-to-end test across all asset categories
    Tool: Playwright
    Preconditions: Clean dev server (npm run dev)
    Steps:
      1. Navigate to /#/pixel
      2. Pokemon: load Bulbasaur → draw → Ctrl+Z → Ctrl+S → verify save
      3. Tileset: load Overworld → extract tile #0 → edit → save → verify
      4. Trainer: load Brock → draw → save → verify
      5. Overworld: load player sprite → draw → save → verify
      6. Switch to Map Editor (/map) → back to /#/pixel → verify state is not corrupted
    Expected Result: All categories work, no crashes, saves persist
    Failure Indicators: Any crash, save failure, state corruption, type error
    Evidence: .sisyphus/evidence/task-14-e2e/
  ```

  **Evidence to Capture**:
  - [ ] Screenshots for each asset category test
  - [ ] `npx vue-tsc --noEmit` output

  **Commit**: YES (Wave 4 group)
  - Message: `feat(pixel): add keyboard shortcuts, tool polish, QA verification`
  - Files: Evidence files only (no source changes)

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Wait for user's explicit "okay" before marking work complete.

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists. For each "Must NOT Have": search codebase for forbidden patterns. Check evidence files. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run `npx vue-tsc --noEmit`. Review all changed files for: `any`/`@ts-ignore`, console.log, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
  Output: `TypeCheck [PASS/FAIL] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real Manual QA** — `unspecified-high` (+ `playwright` skill)
  Start from clean state (`npm run dev`). Execute EVERY QA scenario from EVERY task. Test cross-task integration. Test edge cases: empty canvas, invalid save, rapid tool switching. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`
  For each task: verify everything in spec was built, nothing beyond spec was built. Check "Must NOT do" compliance. Detect cross-task contamination.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | VERDICT`

---

## Commit Strategy

- **Waves 1-4**: One commit per wave (4 total)
  - Wave 1: `feat(pixel): add pixel editor foundation — types, middleware, store, activity registration`
  - Wave 2: `feat(pixel): add canvas grid, drawing tools, palette, undo/redo`
  - Wave 3: `feat(pixel): add asset browser, frame preview, tileset mode, editor integration`
  - Wave 4: `feat(pixel): add keyboard shortcuts, tool polish, QA verification`

---

## Success Criteria

### Verification Commands
```bash
# Type check
npx vue-tsc --noEmit

# Dev server
npm run dev
# → http://localhost:5173/#/pixel 可访问，ActivityBar 显示像素编辑图标

# API test
curl http://localhost:5173/gfx/pokemon/front/bulbasaur.png -o /tmp/test.png
# → 200 OK, PNG 文件
```

### Final Checklist
- [ ] ActivityBar 显示第 8 个图标（🖼 Pixel Editor）
- [ ] 可浏览全部 4 类资产
- [ ] 像素画布正确渲染 + 缩放
- [ ] 4 种工具正常工作
- [ ] DMG 4 色约束生效
- [ ] 撤销/重做可用
- [ ] 保存写回 PNG
- [ ] 帧预览可切换
- [ ] Tileset tile 编辑可用
- [ ] 无破坏现有 Activity
