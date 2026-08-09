// @ts-nocheck -- route handlers use the loose dev-server types (see assets.ts)
import path from 'path'
import fs from 'fs'
import { sendJson, sendError } from '../http'
import { getProjectRoot, configFile } from '../projectConfig'

// ──────────────────────────────────────────────────────────────
// Playtest bundle — GET /api/play/bundle packs the WHOLE open project into
// { "<posix rel path>": "<base64>" } so the browser can boot the WASM
// jrpg-runner (crates/jrpg-runner-web) against an in-memory filesystem.
// ──────────────────────────────────────────────────────────────

/** A single file larger than this is refused (base64 inflates it ~1.33×). */
export const MAX_FILE_BYTES = 16 * 1024 * 1024
/** Total uncompressed size cap for the whole bundle. */
export const MAX_TOTAL_BYTES = 64 * 1024 * 1024

/** Bundle failure carrying an HTTP status (413 for the size caps). */
export class BundleError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

/** Directories that never ship in a playtest bundle. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'target', 'dist'])

export interface BundleOptions {
  maxFileBytes?: number
  maxTotalBytes?: number
}

/**
 * Recursively collect `root` into { "<posix '/'-separated rel path>": "<base64>" }.
 *
 * Sandbox rules (mirrors the assets routes' guard style):
 * - traversal never leaves `root` (we walk real directory entries only);
 * - symlinks are skipped via lstat — never followed;
 * - node_modules/.git/target/dist, `*.bak` and dotfiles/dot-dirs are excluded,
 *   EXCEPT `.jrpg-editor.json` (the runner needs the project manifest).
 *
 * Throws BundleError(413) past the per-file / total size caps.
 */
export function collectProjectFiles(root: string, opts: BundleOptions = {}): Record<string, string> {
  const maxFile = opts.maxFileBytes ?? MAX_FILE_BYTES
  const maxTotal = opts.maxTotalBytes ?? MAX_TOTAL_BYTES
  const files: Record<string, string> = {}
  let total = 0

  const walk = (dir: string, rel: string) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name)
      const st = fs.lstatSync(full)
      if (st.isSymbolicLink()) continue
      const childRel = rel ? `${rel}/${name}` : name
      if (st.isDirectory()) {
        if (SKIP_DIRS.has(name) || name.startsWith('.')) continue
        walk(full, childRel)
      } else if (st.isFile()) {
        if (name !== '.jrpg-editor.json' && (name.startsWith('.') || name.endsWith('.bak'))) continue
        if (st.size > maxFile) {
          throw new BundleError(`File too large: ${childRel} (${st.size} bytes, cap is ${maxFile})`, 413)
        }
        total += st.size
        if (total > maxTotal) {
          throw new BundleError(`Project too large to bundle (>${maxTotal} bytes uncompressed)`, 413)
        }
        files[childRel] = fs.readFileSync(full).toString('base64')
      }
    }
  }
  walk(root, '')
  return files
}

export function registerPlay(server: any) {
  // ── GET /api/play/bundle — whole-project base64 bundle for the WASM runner ──
  server.middlewares.use('/api/play/bundle', (req, res) => {
    if (req.method !== 'GET') { res.writeHead(405); res.end('Method Not Allowed'); return }
    try {
      const root = getProjectRoot()
      if (!root || !fs.existsSync(configFile())) {
        return sendError(res, 'No project open — open a folder with .jrpg-editor.json first', 400)
      }
      const files = collectProjectFiles(root)
      sendJson(res, { files, projectRoot: root })
    } catch (e) {
      const err = e as { message?: string; status?: number }
      sendError(res, err.message ?? 'bundle failed', err.status ?? 500)
    }
  })
}
