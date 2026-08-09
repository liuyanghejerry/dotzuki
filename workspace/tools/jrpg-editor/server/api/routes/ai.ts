// @ts-nocheck -- Vite 8 middleware types changed; this is config glue, not app code
import path from 'path'
import fs from 'fs'
import type { IncomingMessage, ServerResponse } from 'http'

import { sendJson, sendError, readBody } from '../http'
import { resolveDataPath, loadConfig } from '../projectConfig'
import { providersFile, imageProvidersFile, editorSettingsFile } from '../storyPaths'

import { testProvider } from '../../ai'
import { testImageProvider } from '../../spriteSheet/generate'
import { getProjectContext } from '../../context/projectContext'
import { getAction, runAction, legacyEmit, applyChange, streamChat } from '../../actions'
import { sanitizeAssistantSettings } from '../../actions/assistantSettings'
import { checkScene } from '../../sceneCheck'

export function registerAi(server: any) {
  // ── Fallthrough ──
  function nextMiddleware(_req: IncomingMessage, res: ServerResponse) {
    res.writeHead(405); res.end('Method Not Allowed')
  }

  // ── GET/PUT /api/ai/providers — provider profiles (NO api keys, ever) ──
  server.middlewares.use('/api/ai/providers', async (req, res) => {
    try {
      const file = providersFile()
      if (req.method === 'GET') {
        if (!fs.existsSync(file)) return sendJson(res, [])
        return sendJson(res, JSON.parse(fs.readFileSync(file, 'utf-8')))
      }
      if (req.method === 'PUT') {
        const parsed = JSON.parse(await readBody(req))
        const clean = (Array.isArray(parsed) ? parsed : []).map((p: any) => ({
          id: String(p.id || ''),
          kind: p.kind === 'anthropic' ? 'anthropic' : 'openai',
          baseURL: String(p.baseURL || ''),
          model: String(p.model || ''),
          ...(p.proxyUrl ? { proxyUrl: String(p.proxyUrl) } : {}),
          ...(p.embeddingModel ? { embeddingModel: String(p.embeddingModel) } : {}),
          ...(p.imageModel ? { imageModel: String(p.imageModel) } : {}),
        }))
        // The file may be the global ~/.jrpg-editor fallback (no project open).
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, JSON.stringify(clean, null, 2), 'utf-8')
        return sendJson(res, { ok: true })
      }
      return nextMiddleware(req, res)
    } catch (e) {
      sendError(res, (e as Error).message, 500)
    }
  })

  // ── GET/PUT /api/ai/image-providers — IMAGE provider profiles (NO keys) ──
  //    Separate from /api/ai/providers (text). kind: 'openai' | 'gemini'.
  server.middlewares.use('/api/ai/image-providers', async (req, res) => {
    try {
      const file = imageProvidersFile()
      if (req.method === 'GET') {
        if (!fs.existsSync(file)) return sendJson(res, [])
        return sendJson(res, JSON.parse(fs.readFileSync(file, 'utf-8')))
      }
      if (req.method === 'PUT') {
        const parsed = JSON.parse(await readBody(req))
        const clean = (Array.isArray(parsed) ? parsed : []).map((p: any) => ({
          id: String(p.id || ''),
          kind: p.kind === 'gemini' ? 'gemini' : 'openai',
          baseURL: String(p.baseURL || ''),
          model: String(p.model || ''),
          ...(p.proxyUrl ? { proxyUrl: String(p.proxyUrl) } : {}),
        }))
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, JSON.stringify(clean, null, 2), 'utf-8')
        return sendJson(res, { ok: true })
      }
      return nextMiddleware(req, res)
    } catch (e) {
      sendError(res, (e as Error).message, 500)
    }
  })

  // ── POST /api/ai/test-image-provider — render one tiny image to verify key ──
  server.middlewares.use('/api/ai/test-image-provider', async (req, res) => {
    if (req.method !== 'POST') return nextMiddleware(req, res)
    try {
      const { profile, apiKey } = JSON.parse(await readBody(req))
      if (!profile || !apiKey) return sendError(res, 'profile and apiKey are required', 400)
      const result = await testImageProvider(profile, apiKey)
      return sendJson(res, result)
    } catch (e) {
      sendError(res, (e as Error).message, 500)
    }
  })

  // ── GET/PUT /api/editor-settings — editable editor settings (screen size) ──
  //    Lives in `.jrpg-editor.settings.json`; separate from the read-only
  //    `.jrpg-editor.json` project config.
  server.middlewares.use('/api/editor-settings', async (req, res) => {
    try {
      const file = editorSettingsFile()
      if (req.method === 'GET') {
        if (!fs.existsSync(file)) return sendJson(res, {})
        return sendJson(res, JSON.parse(fs.readFileSync(file, 'utf-8')))
      }
      if (req.method === 'PUT') {
        const parsed = JSON.parse(await readBody(req))
        const clean: Record<string, unknown> = {}
        const s = parsed?.screen
        if (s && Number(s.width) > 0 && Number(s.height) > 0) {
          clean.screen = { width: Math.round(Number(s.width)), height: Math.round(Number(s.height)) }
        }
        // AI assistant behavior (user-global skills, code execution) — the
        // sanitizer owns the defaults; only stored when the key is present.
        if (parsed?.assistant !== undefined) {
          clean.assistant = sanitizeAssistantSettings(parsed.assistant)
        }
        fs.writeFileSync(file, JSON.stringify(clean, null, 2), 'utf-8')
        return sendJson(res, { ok: true })
      }
      return nextMiddleware(req, res)
    } catch (e) {
      sendError(res, (e as Error).message, 500)
    }
  })

  // ── POST /api/ai/test-provider — smoke-test a profile + transient key ──
  server.middlewares.use('/api/ai/test-provider', async (req, res) => {
    if (req.method !== 'POST') return nextMiddleware(req, res)
    try {
      const { profile, apiKey, prompt } = JSON.parse(await readBody(req))
      if (!profile || !apiKey) return sendError(res, 'profile and apiKey are required', 400)
      const result = await testProvider(profile, apiKey, prompt)
      return sendJson(res, result)
    } catch (e) {
      sendError(res, (e as Error).message, 500)
    }
  })

  // ── SSE helper: open an event-stream response + return a writer. ──
  function openSse(res: ServerResponse): (event: string, data: unknown) => void {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    return (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  // ── POST /api/ai/run — unified streaming endpoint for every registry action.
  //    Body: { actionId, input, profile, apiKey }. Emits the STANDARD event
  //    vocabulary (start/text/reasoning/partial/tool-*/usage/done/error). New
  //    surfaces (chat, NL→.gui, data set-gen, …) plug in as registry actions. ──
  server.middlewares.use('/api/ai/run', async (req, res) => {
    if (req.method !== 'POST') return nextMiddleware(req, res)
    try {
      const { actionId, input, profile, apiKey } = JSON.parse(await readBody(req))
      if (!profile || !apiKey) return sendError(res, 'profile and apiKey are required', 400)
      const action = getAction(actionId)
      if (!action) return sendError(res, `Unknown action: ${actionId}`, 404)
      const send = openSse(res)
      const ac = new AbortController()
      req.on('close', () => ac.abort())
      await runAction(action, {
        actionId, input: input || {}, profile, apiKey,
        project: getProjectContext(), emit: (t, p) => send(t, p), signal: ac.signal,
      })
      res.end()
    } catch (e) {
      sendError(res, (e as Error).message, 500)
    }
  })

  // ── POST /api/ai/chat — the chat surface on the AI SDK UI message stream,
  //    consumed directly by @ai-sdk/vue useChat. Proposals ride as transient
  //    data-proposal parts. Body: { messages: UIMessage[], profile, apiKey,
  //    uiContext? }. With no project open the assistant runs in creation mode
  //    (scaffold-drafting tools only), so the welcome screen can chat too. ──
  server.middlewares.use('/api/ai/chat', async (req, res) => {
    if (req.method !== 'POST') return nextMiddleware(req, res)
    try {
      const { messages, profile, apiKey, uiContext, imageProviders, debug } = JSON.parse(await readBody(req))
      if (!profile || !apiKey) return sendError(res, 'profile and apiKey are required', 400)
      // loadConfig is the no-project probe: it throws when no .jrpg-editor.json.
      let project = null
      try { loadConfig(); project = getProjectContext() } catch { project = null }
      const ac = new AbortController()
      req.on('close', () => ac.abort())
      await streamChat({
        res, project, profile, apiKey, uiMessages: Array.isArray(messages) ? messages : [],
        uiContext, imageProviders: Array.isArray(imageProviders) ? imageProviders : [],
        debug: debug === true, signal: ac.signal,
      })
    } catch (e) {
      if (!res.headersSent) sendError(res, (e as Error).message, 500)
    }
  })

  // ── POST /api/scene-lint — deterministic .scene lint (flags + game.* API).
  //    (Distinct path; /api/scripts/* is the file read/write route.) ──
  server.middlewares.use('/api/scene-lint', async (req, res) => {
    if (req.method !== 'POST') return nextMiddleware(req, res)
    try {
      const { content } = JSON.parse(await readBody(req))
      const { lintScene } = await import('../../sceneLint')
      sendJson(res, { findings: lintScene(getProjectContext(), String(content ?? '')) })
    } catch (e) {
      sendError(res, (e as Error).message, 500)
    }
  })

  // ── GET /api/ai/mentions — every @-mentionable project item (for the chat
  //    autocomplete): characters, quests, arcs, scenes, data records, gui, maps. ──
  server.middlewares.use('/api/ai/mentions', (req, res) => {
    try { sendJson(res, getProjectContext().mentionIndex()) }
    catch (e) { sendError(res, (e as Error).message, 500) }
  })

  // ── POST /api/ai/apply-change — apply ONE accepted proposal from the review
  //    tray. Resolves the target file per kind and writes it, returning the
  //    previous content as `backup` for Revert. op:'delete' reverts a create. ──
  server.middlewares.use('/api/ai/apply-change', async (req, res) => {
    if (req.method !== 'POST') return nextMiddleware(req, res)
    try {
      const { target, op, after, expect, force } = JSON.parse(await readBody(req))
      if (!target || !target.kind) return sendError(res, 'target is required', 400)
      const result = applyChange(getProjectContext(), { target, op, after, expect, force })
      sendJson(res, result)
    } catch (e) {
      sendError(res, (e as Error).message, 500)
    }
  })

  // ── POST /api/ai/refine-character — legacy shim over the registry. Streams
  //    the old vocab via legacyEmit so CharacterEditor.vue keeps working. ──
  server.middlewares.use('/api/ai/refine-character', async (req, res) => {
    if (req.method !== 'POST') return nextMiddleware(req, res)
    try {
      const { characterId, profile, apiKey } = JSON.parse(await readBody(req))
      if (!profile || !apiKey) return sendError(res, 'profile and apiKey are required', 400)
      const send = openSse(res)
      await runAction(getAction('refine-character')!, {
        actionId: 'refine-character', input: { characterId }, profile, apiKey,
        project: getProjectContext(), emit: legacyEmit('refine-character', send),
      })
      res.end()
    } catch (e) {
      sendError(res, (e as Error).message, 500)
    }
  })

  // ── POST /api/ai/generate-scene — legacy shim over the registry. ──
  server.middlewares.use('/api/ai/generate-scene', async (req, res) => {
    if (req.method !== 'POST') return nextMiddleware(req, res)
    try {
      const { questId, profile, apiKey, sceneName, storyline, previousError } = JSON.parse(await readBody(req))
      if (!profile || !apiKey) return sendError(res, 'profile and apiKey are required', 400)
      const send = openSse(res)
      await runAction(getAction('generate-scene')!, {
        actionId: 'generate-scene', input: { questId, sceneName, storyline, previousError }, profile, apiKey,
        project: getProjectContext(), emit: legacyEmit('generate-scene', send),
      })
      res.end()
    } catch (e) {
      sendError(res, (e as Error).message, 500)
    }
  })

  // ── POST /api/ai/apply-scene — write a generated scene + validate it ──
  server.middlewares.use('/api/ai/apply-scene', async (req, res) => {
    if (req.method !== 'POST') return nextMiddleware(req, res)
    try {
      const { sceneName, content } = JSON.parse(await readBody(req))
      if (!sceneName || typeof content !== 'string') return sendError(res, 'sceneName and content are required', 400)
      // resolveSceneRel: edit the existing scene in place when sceneName names one
      // (stem or path), matching what the generate-scene action resolved against.
      const targetRel = getProjectContext().resolveSceneRel(sceneName)
      const abs = resolveDataPath(targetRel)
      const backup = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf-8') : null
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, content, 'utf-8')

      // Same validation entry as the assistant's check_scene tool:
      // scene.checkCmd (legacy validateCmd) → WASM compile + lint → lint only,
      // so the generate → apply → fix loop works out of the box.
      const result = await checkScene(getProjectContext(), sceneName, content)
      const validation = {
        ok: result.ok,
        output: `[${result.source}] ${result.ok ? 'PASS' : 'FAIL'}\n${result.output}`,
      }
      sendJson(res, { ok: true, path: targetRel, backup, validation })
    } catch (e) {
      sendError(res, (e as Error).message, 500)
    }
  })
}
