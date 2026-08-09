# Stage 3 — Vue Editor UI

## Status: Detailed Plan Deferred

This file is an **outline only**. Stage 3 should not be planned in detail until Stage 1 and Stage 2 ship and we have hands-on experience with the wasm preview's behavior. Premature detailed planning here will cost rework.

## Goal

Add a "UI Layout" activity to `tools/game-editor` (Vue 3 + Pinia) that lets a designer:

1. Pick a screen from a dropdown
2. Pick a mock state (e.g. "long item list", "empty bag")
3. See the wasm-rendered preview as a pixel-upscaled canvas
4. Drag handles on tile boxes to resize/move
5. Edit numeric x/y/w/h fields with immediate preview update
6. Edit label text inline
7. Undo/redo any change
8. Save changes back to the source `.json` file via Vite middleware
9. Show diff against on-disk JSON

## Architecture Sketch

```
tools/game-editor/src/
├── activities/
│   └── ui-layout/
│       ├── UILayoutActivity.vue          # Top-level activity component
│       ├── ScreenPicker.vue              # Dropdown of screens
│       ├── MockStatePicker.vue           # Dropdown of mock states
│       ├── PreviewCanvas.vue             # <canvas> + drag handle overlays
│       ├── PropertiesPanel.vue           # Numeric/text inputs for selected element
│       ├── HistoryPanel.vue              # Undo/redo + diff viewer
│       └── JSONEditor.vue                # Raw JSON view (escape hatch)
├── stores/
│   └── ui-layout-store.ts                # Pinia store: current screen, layout JSON, history, dirty flag
└── composables/
    ├── usePreview.ts                     # Wraps PreviewSession from wasm
    ├── useDragHandles.ts                 # Translates pointer events to JSON edits
    └── useLayoutPersist.ts               # GET/PUT to Vite middleware for file I/O
```

## Pinia Store Sketch

```typescript
// stores/ui-layout-store.ts
import { defineStore } from 'pinia';

export const useUiLayoutStore = defineStore('uiLayout', {
    state: () => ({
        screen: null as string | null,
        mockState: 'default' as string,
        layoutJson: '{}' as string,        // current edited JSON
        savedLayoutJson: '{}' as string,   // last-saved version
        history: [] as string[],            // undo stack of layoutJson snapshots
        historyIndex: 0,
        selectedElement: null as { kind: 'box' | 'cursor' | 'primitive', id: string } | null,
    }),
    getters: {
        isDirty: (s) => s.layoutJson !== s.savedLayoutJson,
        canUndo: (s) => s.historyIndex > 0,
        canRedo: (s) => s.historyIndex < s.history.length - 1,
    },
    actions: {
        async loadScreen(name: string) { /* ... */ },
        commitChange(newJson: string) { /* push to history, update preview */ },
        undo() { /* ... */ },
        redo() { /* ... */ },
        async save() { /* PUT to Vite middleware → writes ui_layouts/{screen}.json */ },
    },
});
```

## File I/O via Vite Middleware

Existing pattern in `tools/game-editor/vite.config.ts` already includes API middleware (per oracle audit, line 647). Add new endpoints:

```typescript
// vite.config.ts middleware additions
server.middlewares.use('/api/ui-layout', async (req, res) => {
    if (req.method === 'GET') {
        const screen = url.parse(req.url, true).query.screen;
        const json = await fs.readFile(
            `../../crates/pokered-data/ui_layouts/${screen}.json`, 'utf-8'
        );
        res.end(json);
    } else if (req.method === 'PUT') {
        const screen = url.parse(req.url, true).query.screen;
        const body = await readBody(req);
        // Validate JSON parses
        JSON.parse(body);
        await fs.writeFile(
            `../../crates/pokered-data/ui_layouts/${screen}.json`, body
        );
        res.end('OK');
    }
});
```

After save, the editor recommends running `cargo build` (or invokes it via another endpoint) so the codegen picks up the new layout.

## Drag Handle Implementation

Each `<canvas>` is overlaid with absolutely-positioned divs at the corners and edges of each `BoxDef.rect`. Pointer events translate to `tx`/`ty`/`tw`/`th` deltas (snapped to tile grid — tiles are 8×8 px, canvas is upscaled e.g. 4× → 32px per tile).

```typescript
// composables/useDragHandles.ts
function onDrag(box: BoxDef, handle: 'nw'|'n'|'ne'|'e'|'se'|'s'|'sw'|'w', dx: number, dy: number) {
    const tileDx = Math.round(dx / TILE_PIXEL_SIZE);
    const tileDy = Math.round(dy / TILE_PIXEL_SIZE);
    // Mutate box.rect according to handle, commit through store
    store.commitChange(updatedJson);
}
```

The store re-parses JSON, hands to wasm preview, re-renders canvas. < 16ms per drag tick.

## Detailed Substeps (Outline Only — Plan in Detail Later)

1. **3.1 Activity scaffolding** — register route, add to nav, basic layout
2. **3.2 Preview canvas + screen picker** — render works, no editing yet
3. **3.3 Mock state picker** — switch states, see different content
4. **3.4 Properties panel** — edit numeric fields, see updates
5. **3.5 Drag handles for boxes** — pointer events, snap-to-tile
6. **3.6 Label editing** — inline text editing
7. **3.7 Primitive editing** — bracket sides toggles, hp_bar params
8. **3.8 Undo/redo** — history stack
9. **3.9 Save + diff** — PUT to Vite middleware, show diff before save
10. **3.10 Polish** — keyboard shortcuts, error toasts, dark mode

## Why Defer Detailed Planning

Stage 3 is the most user-experience-driven stage. Premature planning of drag handle UX, properties panel layout, etc. without seeing the wasm preview in action is guaranteed to produce a plan that needs heavy revision. **Build Stage 1 + 2 first, then plan Stage 3 with the actual preview in front of you.**

Specific things we can't know without Stage 2 in hand:
- How fast is render() actually? (governs whether we need debouncing on drag)
- Does the upscaled canvas look usable at 4×? Need 8×?
- Are the tile boundaries clear enough for drag-snap UX?
- How many mock states actually need to be UI-pickable vs just shipping defaults?

## Estimated Effort

Rough order of magnitude only — refine after Stage 2 ships:

- Without polish: 1 week (5 working days) for a usable but rough editor
- With polish (keyboard shortcuts, error UX, save flow): 2 weeks total

## Stage 3 Exit Gate (preliminary)

- [ ] Designer can edit any migrated screen end-to-end without touching a `.rs` or `.json` file directly
- [ ] Edits persist on save
- [ ] Undo/redo work for every kind of change (drag, numeric, label, primitive)
- [ ] After save + `cargo build`, game uses new layout
- [ ] Editor's preview matches game appearance pixel-for-pixel (already guaranteed by Stage 2)

## Action After Stage 2

When Stage 2 exit gate passes:

1. Spawn a dedicated planning round for Stage 3
2. Have a designer try Stage 2's preview with hand-edited JSON to validate UX assumptions
3. Write detailed substep plans (3.1–3.10) with the preview in front of us
4. Get momus review of Stage 3 detailed plan
5. Implement Stage 3
