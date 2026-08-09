# jrpg-editor — AI Agent Framework Design

Status: **in progress** — the spine + chat flagship have landed (see *Implementation status*) · Branch: `feature/editor-ai-integration`

Goal: deepen AI integration across *every* editing surface of jrpg-editor by benchmarking against
modern "AI at work" agents (Cursor / Devin / Copilot Workspace / v0) and weaving their paradigms
into the concrete game-authoring workflows — instead of more bespoke per-panel AI buttons.

## Direction (decided)

| Decision | Choice | Consequence |
|---|---|---|
| Sequencing | **Framework-first** | Build the shared substrate before features; each later feature is then a thin registry entry. |
| Flagship paradigm | **Chat-with-context assistant** | One conversational surface over the whole project that acts via tools. The headline deliverable. |
| Autonomy / trust | **Propose → review → apply** | The agent **never writes directly**. It emits a reviewable `ChangeSet`; the human applies diffs. |
| Generality | **Fully config-driven** | Zero wuxia/pokered hardcoding. Everything is driven off `.jrpg-editor.json` activity config. |

## Benchmarks & mental models (product direction)

The benchmark set has widened: beyond the AI-at-work dev tools above, the onboarding flow now benchmarks against
**office AI products** — their mental model matches the editor's real users (authors, not engine programmers)
far better than engine tooling does.

- **Kimi Work** (Moonshot AI, Beta 2026-06) — a local-file agent + WebBridge web automation + 24/7 cron-scheduled
  tasks, aimed at knowledge workers.
- **Codex desktop** (OpenAI) — an agent command center: multi-thread sessions, plan/approval UX (plan mode,
  approve/deny, hooks), diff summaries, token statistics, desktop control.

Four mental models taken from them:

| # | Mental model | Consequence for the editor |
|---|---|---|
| 1 | **Task as the object** | Home = recent tasks + a one-line start box, not a grid of feature entries. |
| 2 | **Conversation as creation, output as artifact** | Review the artifact, not the process; artifacts can be previewed, jumped to, traced back. |
| 3 | **Transparency + tiered authorization** | Plan / steps / diff / token cost all visible; low-risk changes auto-apply, high-risk stops for a human. |
| 4 | **Long-term relationship** | Memory, cross-session continuity, scheduled background tasks. |

**North-star metric: time-to-first-playable-scene** — from the user's first sentence to the first playable
scene. It replaces feature coverage as the onboarding-flow metric.

## Implementation status (as-built)

Five commits on `feature/editor-ai-integration`. All server logic is covered by vitest (68 passing) and the
whole chain has been live-verified against the wuxia project + the MiMo provider.

| Slice | Commit | What landed |
|---|---|---|
| **Layer 1 — ProjectContext** | `c1a9c559` | Config-driven read/retrieval module + structured retrieval; `assembleContext()` auto-samples real scenes so generation is grounded even when `ai` is unset (fixes the wuxia empty-context bug). |
| **Layer 2 — Registry + endpoint** | `952bb74f` | One `POST /api/ai/run`, the standard SSE event vocab, usage capture; `refine-character` + `generate-scene` migrated on, old endpoints kept as thin legacy shims. |
| **Layer 3 — Tool loop + ChangeSet** | `4453a968` | `runAgent`, the READ tools, the PROPOSE tools that stage to a `ChangeSet` (never write disk), and the `assistant` action. |
| **Apply surface** | `84b685dc` | `POST /api/ai/apply-change` writes one accepted proposal (per-kind path resolution) and returns a `backup` for Revert. |
| **Layer 4 — Chat panel** | `84b685dc` | `AssistantPanel.vue` (dockable chat, provider select, streamed replies, tool activity) + `ProposalCard.vue` review tray (diff, Apply / Apply-all / Discard / Revert), wired into the shell. |
| **Panel UX** | `ee6dc58b` | Markdown rendering (dep-free, XSS-safe), drag-to-resize width (persisted), `@mention` autocomplete (`GET /api/ai/mentions`). |
| **AI SDK chat engine** | `fcb4d55e` | Migrated the chat to the **Vercel AI SDK UI message stream + `@ai-sdk/vue` `useChat`** (`POST /api/ai/chat`, `createUIMessageStream`→`pipeUIMessageStreamToResponse`); proposals ride as transient `data-proposal` parts. Gets streaming/tool-parts/stop/status from the SDK; our ChangeSet stays the custom layer. |

Live-verified end-to-end: the assistant reads a real character then **proposes** an edit (a `proposal` with a
diff); **apply** writes it (file changes, backup captured); **revert** restores it byte-identical. Refines vs the
**Apply** design note (Layer 3): rather than the client mapping each target kind to a different existing mutation
endpoint, a single `POST /api/ai/apply-change` resolves the file server-side (handling the data-table filename
convention) and returns the previous content for a uniform Revert.

**Cold surfaces — now lit up** (each an AI affordance wired into the real edit/save flow):

| Surface | How |
|---|---|
| **GUI** | `generate-gui` action (list/read/submit tool loop) + a ✨ bar; applies to the editor, validates via the WASM `compileScreen`, "Fix" re-runs with the compile error (generate→compile→fix). |
| **Data** | `generate-data-set` + `batch-edit-data` (Zod from `TableDef.fields`) emit `proposal`s → `DataGenerator` modal renders ProposalCard diffs, applies via `apply-change`. |
| **Script** | `generate-scene-snippet` (grounded by real scenes) → ✨ bar inserts the snippet at the CodeMirror cursor. |
| **Map** | `POST /api/maps/generate-backdrop` (image provider) + `MapBackdropGen` ✨ dialog → writes `source.png`, repaints. |
| **Assets** | `POST /api/cv-process` (deterministic: chroma/quantize/pixelize) + pixel-editor buttons (抠底/调色/栅格), applied as one undo entry. |

Shared client plumbing: `useAiGenerate` (provider+key+`/api/ai/run` streaming) and `useProposals` (the review tray,
shared with the chat). The text actions (gui/data/script) run through the registry on `/api/ai/run`; map/assets are
the image/CV track (separate endpoints). All live-verified except the two image-provider paths (test token is text-only).

**Follow-ups — done:**
- **DSL lint** — `POST /api/scene-lint` (flags read-but-never-set / set-but-never-read, + `game.*` vs `ai.apiTypes`); 🔍 panel in the script editor with jump-to-line.
- **Token meter + prompt-cache** — `useAiUsage` accumulates the `usage` events (chat via `messageMetadata`); the assistant header shows a readout. `streamChat` marks the system block with Anthropic `cacheControl` (no-op for openai-compatible).
- **Embeddings RAG (phase B)** — `server/retrieval.ts` (buildCorpus + cosine + topK; corpus embedded once, cached); `streamChat` augments context with top-K chunks when a provider has an `embeddingModel` (gated, off by default).
- **Selection-scoped CV + AI inpaint** — the pixel-editor CV assists honor the active selection; `POST /api/cv-inpaint` image-edits a region via the image provider (✨ AI 修复).

**Still open:** wire RAG into the per-activity generate actions (not just chat); a price table for the token meter; surface lint inline as CodeMirror diagnostics (gutter markers) rather than a side panel.

## Where the editor sits today (baseline)

Two rich corners, five cold surfaces, and almost none of the connective tissue of an agent IDE.

- **Story Designer** — rich. `refine-character` (`streamObject`+Zod), a real scene-writer *agent*
  (`read_file`/`list_scenes`/`submit_scene` + a generate→validate→fix loop), sprite gen, a deterministic story lint.
- **Sprite pipeline** — rich. The crown jewel: a self-correcting *measure→retry-with-hints* loop. The most
  "Devin-like" code already in the repo. Generalize this pattern, don't rebuild it.
- **AI infra** — rich *plumbing only*. `buildModel()` (vendor-agnostic anthropic + openai-compatible, proxy,
  dynamic import), `makeGenImage()` (openai + gemini multimodal refs), a single `streamSse` client reader.
  But: no retrieval/RAG, no cache, no usage capture, no per-activity defaults, keys in one browser's localStorage.
- **Script / `.scene`** — partial. AI scene-gen exists **only** in Story Designer bound to a saved quest; the
  actual script editor has zero language intelligence (uses the wrong `javascript()` CodeMirror mode).
- **GUI / `.gui`** — **none**, yet has the **best validation oracle in the repo**: `wasm.compileScreen`
  returns `line:col` errors and `renderGui` returns exact pixels.
- **Data tables** — **none**. Manual JSON, yet `TableDef.fields → Zod` is a direct reuse of `refineCharacter`.
- **Map** — minimal. Only an out-of-editor backdrop image (`source.png`) for tracing.
- **Assets / pixel** — **none**, yet the sprite pipeline already ships every CV primitive these need
  (`chroma` matte, `segment`, `quantize`, `pixelize`) — none wired into the Tiles/pixel-editor path.

Against the five paradigms: strong **generate-from-intent** (2 artifacts), **one agentic loop** (scene-writer),
and only *read-only* ambient lint. **Zero** chat-with-context, **zero** inline completion, **zero** "fix with AI".

> Known live gap: the wuxia project ships `ai: null`, so even the scene-writer agent
> runs with **empty context**. The framework fixes this at the root (context provider).
> (The compile-check half is solved: `check_scene` now defaults to the bundled jrpg-web
> WASM compiler — `scene.checkCmd` → WASM compile → lint — so no per-project
> `checkCmd` is required.)

## The architecture: one substrate, three layers, a tool surface

What makes agent IDEs feel like *work* is one substrate — a context layer that knows the whole project, a tool
surface the agent acts through, and a chat/agentic loop on top — where every feature is a thin entry. The editor
does the opposite today: each `/api/ai/*` route in the 2024-line `vite.config.ts` monolith re-implements
body-parse + key-validation + the SSE write loop + a fixed file-slice "context." That is why five surfaces are
cold: every feature costs a bespoke endpoint.

```
                       ┌─────────────────────────────────────────────────────┐
   Assistant panel ───►│  POST /api/ai/run   (single SSE endpoint)            │
   (+ per-activity     │     │                                               │
    action buttons)    │     ▼                                               │
                       │  Action Registry  id→{kind, system, messages,        │  Layer 2
                       │                       tools, schema, sink}           │
                       │     │            runObject │ runAgent │ runChat       │
                       │     ▼                                               │
                       │  Tool surface:  READ tools (exec now)  ┐             │  Layer 3
                       │                 PROPOSE tools → ChangeSet            │
                       │     │                                  │             │
                       │     ▼                                  ▼             │
                       │  ProjectContext  (structured retrieval over          │  Layer 1
                       │   stories/scenes/flags/data/gui/maps/DSL guide)      │
                       │     │                                               │
                       │     ▼                                               │
                       │  buildModel(profile,key)  +  usage + prompt-cache    │  Layer 0
                       └─────────────────────────────────────────────────────┘
   proposals stream back ──► client review tray (diffs) ──► Apply ──► existing mutation endpoints
```

### Layer 0 — Streaming + provider (mostly exists; small additions)

- Keep `server/ai.ts buildModel(profile, apiKey)`. **Add**: capture `usage` (AI SDK already returns it, currently
  discarded) and optional Anthropic prompt-cache control on the large stable system/context block.
- **Standard SSE event vocabulary v1** (replaces today's ad-hoc per-endpoint events), consumed once by `useAiStream`:

  | event | payload | meaning |
  |---|---|---|
  | `start` | `{actionId, runId}` | run began |
  | `text` | `{delta}` | assistant prose |
  | `reasoning` | `{delta}` | model reasoning (optional) |
  | `partial` | `{object}` | streamed structured output (e.g. refine-character) |
  | `tool-call` | `{id, name, args}` | agent invoked a read/propose tool |
  | `tool-result` | `{id, ok, summary}` | tool returned |
  | `proposal` | `{id, target, diff, rationale}` | **a reviewable edit** (the propose→review→apply unit) |
  | `progress` | `{label, pct}` | long pipelines (sprite) |
  | `usage` | `{inTok, outTok, costEst}` | token/cost accounting |
  | `done` | `{result}` | run complete |
  | `error` | `{message, where}` | failure |

### Layer 1 — Project Context Provider (`server/context/`)

One module built from `.jrpg-editor.json`, generalizing the `readStoryRecord` / `scanFlags` / `listSceneNames` /
`assembleAiContext` helpers currently scattered in `vite.config.ts`.

- **Read API**: `listCharacters/Quests/Arcs`, `readStoryRecord(kind,id)`, `listScenes`, `readScene`, `scanFlags`,
  `listTables`, `listRecords(table)`, `readRecord(table,id)`, `listGui`, `readGui`, `listMaps`, `readMapMeta`,
  `getDslGuide`, `getApiTypes`, `getExampleScenes`.
- **Retrieval — phase A (structured, ship first):** resolve `@mentions` and *follow references* deterministically —
  a quest pulls its giver/characters, its `requires`/`sets` flags, its `implementedBy` scenes; a character pulls its
  relationships. This alone fixes the empty-context problem, is cheap, and needs no embeddings.
- **Retrieval — phase B (optional, later):** an embeddings index for fuzzy "find relevant" queries, reusing
  `buildModel` provider config + a new optional `embeddingModel` field. Not required for the flagship.
- **Config-driven:** every path/table/dir comes from the project config's activity definitions. No game knowledge.

### Layer 2 — Action Registry + single endpoint (`server/actions/`)

```ts
interface AiAction {
  id: string;                 // 'refine-character' | 'generate-scene' | 'generate-gui' | 'chat' | ...
  kind: 'object' | 'agent' | 'chat';
  title: string;
  system(ctx, input): string;
  messages?(ctx, input): Message[];      // chat/agent
  prompt?(ctx, input): string;           // object
  tools?(ctx, changeset): ToolSet;       // agent/chat
  schema?: ZodSchema;                    // object
  sink?(result, ctx): void;              // optional persistence hook
}
```

- **One endpoint** `POST /api/ai/run` (SSE): `{actionId, input, profile, apiKey}` → look up action → assemble
  context via `ProjectContext` → dispatch to `runObject` (`streamObject`), `runAgent` (tool loop), or `runChat`
  → stream the standard event vocab. Collapses the four copy-pasted middlewares into one.
- **Migration without breakage:** move `refine-character` (object) and `generate-scene` (agent) onto the registry
  first; keep the old `/api/ai/*` routes as thin shims that call `runAction(...)` so nothing breaks mid-migration.
  Image actions (`generate-sprite`, `generate-animated`) keep their own endpoints (different shape) but emit the
  standard event vocab so the client stays uniform.

### Layer 3 — Tool surface + the `ChangeSet` (this is where the trust model lives)

- **READ tools** (execute immediately, return data to the model):
  `read_file`, `list_scenes`, `read_scene`, `scan_flags`, `list_tables`, `list_records`, `read_record`,
  `list_gui`, `read_gui`, `list_characters`, `read_character`, `list_quests`, `read_quest`,
  **`compile_gui`** (the exact validation oracle) and **`validate_scene`** (`validateCmd`).
- **PROPOSE tools** (do **not** mutate — append to a `ChangeSet` and emit a `proposal` event with a computed diff):
  `propose_story_edit({kind,id,patch})`, `propose_data_edit({table,id,patch})`, `propose_scene_write({path,content})`,
  `propose_gui_write({name,content})`, `propose_map_edit(...)`.
- **Self-correction still works** under propose→review: the agent may call `compile_gui` / `validate_scene` on a
  candidate *before* emitting the proposal and revise on errors (fed back like `generate-scene`'s `previousError`).
  Nothing is applied — the loop runs entirely against not-yet-applied content.
- **Client review tray:** proposals render as diff cards; **Apply** (per-proposal or Apply-all) calls the *real,
  already-existing* mutation endpoints — `PUT /api/stories`, `/api/data/save`, `PUT /api/scripts`, `PUT /api/gui`,
  `/api/maps` — with backup/revert. This is exactly the `SceneGenerator` propose→apply→revert UX, generalized to a
  multi-edit batch spanning activities.

> **The split is the design.** The agent is powerful (multi-step, multi-artifact, self-validating) but only ever
> *proposes*; the human applies. That is the literal embodiment of the chosen trust model, applied uniformly to
> every surface for free.

### Layer 4 — The Chat-with-context Assistant (flagship)

- A persistent, dockable **Assistant panel** available from every activity, implicitly seeded with the current
  activity + selection. Multi-turn (client holds history) — the first cross-call memory in the editor.
- Each turn → the `chat` action → `runAgent` with the full READ+PROPOSE tool surface + `ProjectContext`.
- **`@mentions`**: typing `@` offers characters / quests / scenes / data records / gui files / maps (from
  `ProjectContext`); selected mentions pin those records (+ their references) into the turn's context.
- **Output** = streamed prose + a collapsible tool/activity log + `proposal` cards in the review tray.
- Must handle, end-to-end:
  - *"add a rival for chen-yuan with a betrayal arc and wire the flags"* → proposes a new character + quest + flag wiring.
  - *"rename EVENT_X everywhere"* → `scan_flags` + multi-file proposals.
  - *"why is this quest unreachable?"* → read-only; prose answer from `scan_flags` + lint.
  - *"a 2-column party menu with HP bars"* → proposes a `.gui`, self-validated via `compile_gui`.
- **Config-driven:** the available tool surface is generated from which activities the project config enables.

## Milestone plan (framework-first)

- **M1 — Streaming + context spine.** Standard SSE vocab in `useAiStream`; `ProjectContext` module (structured
  read + `@mention` resolution); wire it so the wuxia empty-context bug is fixed. Migrate `refine-character` +
  `generate-scene` onto `/api/ai/run` behind the registry (proves the registry with no new UX). Capture `usage`.
- **M2 — Tool loop + ChangeSet.** Reusable `runAgent`; READ tools; PROPOSE tools + `ChangeSet`; client review tray
  with diffs + Apply/Apply-all wired to existing mutation endpoints. (Now propose→review→apply works generically.)
- **M3 — Chat assistant (flagship).** The Assistant panel: multi-turn, `@mentions`, the `chat` action over the full
  tool surface + context. The headline deliverable.
- **M4 — Light up surfaces as actions.** NL→`.gui` (with `compile_gui` self-correction), data set-gen + NL
  batch-edit, DSL lint/autofix in the script editor, story-lint autofix — each a registry entry, surfaced both as a
  standalone action button *and* reachable via chat.
- **M5 — (optional) economy + retrieval.** Embeddings retrieval (phase B), Anthropic prompt-cache, a token/cost panel.

Post-flagship, the plan shifts from framework to **onboarding** (north star: time-to-first-playable-scene — see
*Benchmarks & mental models*):

- **M6 — Task-oriented home + artifact list (P0, done).** The welcome screen's main entry is the
  conversation input + recent tasks (task as the object, not activity shortcuts); each session aggregates an
  artifact list of what it produced, with click-to-jump into the owning editor.
- **M7 — Change summary + tiered authorization + assistant memory (P1, done).** Per-change diff stats (line
  counts) + token cost; auto-apply per change kind, with meta-operations always requiring approval; memory files
  (project-level + global) + a `remember_fact` tool.
- **M8 — Multi-session threads (P2, done) + background scheduled tasks (P3, done).** Threads shipped:
  per-thread message/proposal-tray/plan snapshots, a list UI with titles + relative times, and stream-time
  locking. Scheduled jobs run on a client-side scheduler (30s tick, serial): `scene-check` lints every
  `.scene` via a server endpoint, `agent-prompt` runs a headless chat round whose proposals land in the
  review tray (never auto-applied); jobs persist per project in `.jrpg-editor.jobs.json`.

## Reuse map (build on proven seams — do not rebuild)

| New piece | Generalizes / reuses |
|---|---|
| `runAgent` tool loop | `server/sceneWriter.ts aiSdkSceneWriter` (`streamText` + tools + `stopWhen[stepCountIs, hasToolCall]`) |
| `runObject` | `server/ai.ts refineCharacter` (`streamObject` + Zod) |
| Action registry | the partial `SceneWriterBackend` registry already gestures at this |
| `ProjectContext` | `readStoryRecord` / `scanFlags` / `listSceneNames` / `assembleAiContext` in `vite.config.ts` |
| Standard SSE + client | the single `useAiStream.streamSse` reader |
| `compile_gui` oracle | `useWasmPreview.compileScreen` / `renderGui` |
| Data set-gen / batch-edit | `TableDef.fields → Zod`, `/api/data/list`, `/api/data/save` |
| Pixel-editor CV actions | `server/spriteSheet/{chroma,segment,quantize,pixelize}.ts` (all shipped, unused outside sprite gen) |

## Testing

A Xiaomi MiMo coding-plan endpoint (OpenAI-compatible, `kind: 'openai'`) is available for exercising the text
actions end-to-end. Configure it as a text `ProviderProfile` (base URL + key entered in Settings, key stays in
localStorage). **Never commit the key** — it is a transient test credential, not part of the repo.

## Open questions (deferred, not blocking M1)

- **Validators per surface:** GUI has `compile_gui`; scenes are covered by the bundled
  jrpg-web WASM compiler (`check_scene` defaults to it, `scene.checkCmd` still wins)
  with lint layered on top; data has schema; map has none. Remaining: a map-integrity
  check, and route-conflict detection (needs the whole-directory compile pipeline,
  not the single-file WASM oracle).
- **Team key handling:** keys live in one browser's localStorage. Shared projects may want an OS-keychain / server-side
  key. Security posture TBD.
- **Inline completion:** the costliest paradigm (latency, a real grammar). Worth it for a low-volume authoring tool, or
  is generate-from-intent + chat enough?
