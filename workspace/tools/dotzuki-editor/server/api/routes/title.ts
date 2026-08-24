// @ts-nocheck -- dev-server middleware; loose types match the sibling route modules
import path from 'path'
import fs from 'fs'
import type { IncomingMessage, ServerResponse } from 'http'
import { sendJson, sendError, readBody } from '../http'
import { loadConfig, resolveDataPath } from '../projectConfig'
import { makeGenImage } from '../../spriteSheet/generate'
import { resolveApiKey } from '../../ai'
import { encodePNG } from '../../spriteSheet/image'

/** Title-screen editor server surface — currently just AI background generation.
 *  The title `.gui` layout itself is loaded/saved through the shared `/api/gui`
 *  endpoints (the title activity reuses `guiRoot`); only the background PNG needs
 *  a bespoke route. */
export function registerTitle(server: any) {
  // POST /api/title/generate-bg — generate a widescreen title background via an
  //   image provider and write it to the title activity's bgImage path.
  //   body: { prompt, profile, apiKey } → { ok, base64, width, height }.
  server.middlewares.use('/api/title/generate-bg', async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405); res.end('Method Not Allowed'); return }
    try {
      const { prompt, profile, apiKey } = JSON.parse(await readBody(req))
      if (!profile || !resolveApiKey(apiKey, 'image')) return sendError(res, 'profile and apiKey are required', 400)
      if (!prompt || !String(prompt).trim()) return sendError(res, 'prompt is required', 400)

      // Where does the background live? Prefer the title activity's configured
      // bgImage, default to the conventional path. Title screens are widescreen
      // (426×240 ≈ 16:9).
      const cfg = loadConfig()
      const titleAct = cfg.activities.find((a: any) => a.type === 'title-screen')
      const bgRel = (titleAct?.config as { bgImage?: string } | undefined)?.bgImage
        ?? 'data/gfx/title/background.png'

      const fullPrompt = `Widescreen game title-screen background illustration, no text, logo, or UI overlay. ${String(prompt).trim()}`
      const img = await makeGenImage(profile, apiKey)(fullPrompt, '16:9', [])
      const png = encodePNG(img)
      const abs = resolveDataPath(bgRel)
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, png)
      sendJson(res, { ok: true, base64: png.toString('base64'), width: img.width, height: img.height })
    } catch (e) {
      sendError(res, (e as Error).message, 500)
    }
  })
}
