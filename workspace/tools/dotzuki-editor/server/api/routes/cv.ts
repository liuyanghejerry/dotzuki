// @ts-nocheck
import type { IncomingMessage, ServerResponse } from 'http'
import { sendJson, sendError, readBody } from '../http'
import { encodePNG, decodePNG, resample } from '../../spriteSheet/image'
import { makeGenImage } from '../../spriteSheet/generate'
import { resolveApiKey } from '../../ai'

export function registerCv(server: any) {
  function nextMiddleware(_req: IncomingMessage, res: ServerResponse) {
    res.writeHead(405); res.end('Method Not Allowed')
  }

  // ── POST /api/cv-process — deterministic CV assist for the pixel editor
  //    (bg-removal / palette-harmonize / pixelize-grid). No model. ──
  server.middlewares.use('/api/cv-process', async (req, res) => {
    if (req.method !== 'POST') return nextMiddleware(req, res)
    try {
      const { operation, pngBase64, params } = JSON.parse(await readBody(req))
      if (!pngBase64) return sendError(res, 'pngBase64 is required', 400)
      const { processCv } = await import('../../cvProcess')
      const out = processCv(operation, pngBase64, params || {})
      sendJson(res, { ok: true, ...out })
    } catch (e) {
      sendError(res, (e as Error).message, 500)
    }
  })

  // ── POST /api/cv-inpaint — AI image-edit a region (multimodal image provider,
  //    gemini recommended), snapped back to the source tile size. ──
  server.middlewares.use('/api/cv-inpaint', async (req, res) => {
    if (req.method !== 'POST') return nextMiddleware(req, res)
    try {
      const { pngBase64, prompt, profile, apiKey } = JSON.parse(await readBody(req))
      if (!profile || !resolveApiKey(apiKey, 'image')) return sendError(res, 'profile and apiKey are required', 400)
      if (!pngBase64 || !prompt || !String(prompt).trim()) return sendError(res, 'pngBase64 and prompt are required', 400)
      const src = decodePNG(Buffer.from(String(pngBase64).replace(/^data:image\/\w+;base64,/, ''), 'base64'))
      const editPrompt = `Edit this small pixel-art tile image. ${String(prompt).trim()}. Keep the SAME dimensions, low-resolution pixel-art style, and preserve transparency.`
      const result = await makeGenImage(profile, apiKey)(editPrompt, '1:1', [src])
      const sized = (result.width !== src.width || result.height !== src.height) ? resample(result, src.width, src.height) : result
      sendJson(res, { ok: true, pngBase64: 'data:image/png;base64,' + encodePNG(sized).toString('base64') })
    } catch (e) {
      sendError(res, (e as Error).message, 500)
    }
  })
}
