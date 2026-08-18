// @ts-nocheck -- Vite 8 middleware types changed; this is config glue, not app code
import { sendJson } from '../http'
import { dshStatus } from '../../dsh'

/** GET /api/dsh/status — probe the optional DeepSeek Harness runtime install. */
export function registerDsh(server: any) {
  server.middlewares.use('/api/dsh/status', (_req, res) => {
    sendJson(res, dshStatus())
  })
}
