// @ts-nocheck -- extracted from vite.config.ts; loose types preserved verbatim
import path from 'path'
import fs from 'fs'
import type { IncomingMessage, ServerResponse } from 'http'
import { sendJson, sendError, readBody, parseUrl } from '../http'
import { loadConfig, resolveDataPath } from '../projectConfig'
import { createMap, createMapTmx } from '../mapCreate'
import { getProjectContext } from '../../context/projectContext'
import { makeGenImage } from '../../spriteSheet/generate'
import { generateMapBackdrop } from '../../backdropTools'

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Whole-word (identifier-boundary) matcher for a map name in free text (scenes),
// so `Bianliang` never matches inside `BianliangB`, a flag, or another id. Map
// names are ASCII, so this won't touch Chinese dialogue/prose.
function nameBoundaryRe(name: string): RegExp {
  return new RegExp(`(?<![A-Za-z0-9_-])${escapeRegExp(name)}(?![A-Za-z0-9_-])`, 'g')
}

/** Every editor-managed file that can reference a map by name, with its kind:
 *  warp = objects.json (warps[].dest_map), scene = script.scene (@trigger / warpTo
 *  / game_scene / comments), quest = story/quests/*.json (implementedBy[].scene). */
function mapRefFiles(): { abs: string; rel: string; kind: 'warp' | 'scene' | 'quest' }[] {
  const cfg = loadConfig()
  const mapAct = cfg.activities.find((a: any) => a.type === 'map')
  const storyAct = cfg.activities.find((a: any) => a.type === 'story')
  const files: { abs: string; rel: string; kind: 'warp' | 'scene' | 'quest' }[] = []
  const mapsRel = mapAct?.config?.mapsDir ?? 'data/maps'
  const mapsDir = resolveDataPath(mapsRel)
  if (fs.existsSync(mapsDir)) {
    for (const d of fs.readdirSync(mapsDir)) {
      const md = path.join(mapsDir, d)
      if (!fs.statSync(md).isDirectory()) continue
      const oj = path.join(md, 'objects.json')
      if (fs.existsSync(oj)) files.push({ abs: oj, rel: `${mapsRel}/${d}/objects.json`, kind: 'warp' })
      const sc = path.join(md, 'script.scene')
      if (fs.existsSync(sc)) files.push({ abs: sc, rel: `${mapsRel}/${d}/script.scene`, kind: 'scene' })
    }
  }
  const storiesRel = storyAct?.config?.storiesDir
  if (storiesRel) {
    const qd = resolveDataPath(path.join(storiesRel, 'quests'))
    if (fs.existsSync(qd)) {
      for (const f of fs.readdirSync(qd)) {
        if (f.endsWith('.json')) files.push({ abs: path.join(qd, f), rel: `${storiesRel}/quests/${f}`, kind: 'quest' })
      }
    }
  }
  return files
}

/** Count references to `name` per file (drives the confirm prompt). */
function scanMapRefs(name: string): { refs: { file: string; kind: string; count: number }[]; total: number } {
  const refs: { file: string; kind: string; count: number }[] = []
  let total = 0
  for (const f of mapRefFiles()) {
    let count = 0
    try {
      if (f.kind === 'warp') {
        const d = JSON.parse(fs.readFileSync(f.abs, 'utf-8'))
        count = (Array.isArray(d?.warps) ? d.warps : []).filter((w: any) => w?.dest_map === name).length
      } else if (f.kind === 'quest') {
        const d = JSON.parse(fs.readFileSync(f.abs, 'utf-8'))
        count = (Array.isArray(d?.implementedBy) ? d.implementedBy : []).filter((x: any) => x?.scene === name).length
      } else {
        const m = fs.readFileSync(f.abs, 'utf-8').match(nameBoundaryRe(name))
        count = m ? m.length : 0
      }
    } catch { count = 0 }
    if (count > 0) { refs.push({ file: f.rel, kind: f.kind, count }); total += count }
  }
  return { refs, total }
}

/** Rewrite every reference `oldName` → `newName`. Returns the number of files
 *  changed. Run AFTER the directory rename so the map's own moved scene is
 *  rewritten too. Structured JSON fields are edited by value; scenes by
 *  whole-word text replace. */
function rewriteMapRefs(oldName: string, newName: string): number {
  let changed = 0
  for (const f of mapRefFiles()) {
    try {
      if (f.kind === 'warp') {
        const d = JSON.parse(fs.readFileSync(f.abs, 'utf-8'))
        let dirty = false
        for (const w of (Array.isArray(d?.warps) ? d.warps : [])) {
          if (w?.dest_map === oldName) { w.dest_map = newName; dirty = true }
        }
        if (dirty) { fs.writeFileSync(f.abs, JSON.stringify(d, null, 2), 'utf-8'); changed++ }
      } else if (f.kind === 'quest') {
        const d = JSON.parse(fs.readFileSync(f.abs, 'utf-8'))
        let dirty = false
        for (const x of (Array.isArray(d?.implementedBy) ? d.implementedBy : [])) {
          if (x?.scene === oldName) { x.scene = newName; dirty = true }
        }
        if (dirty) { fs.writeFileSync(f.abs, JSON.stringify(d, null, 2), 'utf-8'); changed++ }
      } else {
        const txt = fs.readFileSync(f.abs, 'utf-8')
        const nw = txt.replace(nameBoundaryRe(oldName), newName)
        if (nw !== txt) { fs.writeFileSync(f.abs, nw, 'utf-8'); changed++ }
      }
    } catch { /* skip unreadable / corrupt files */ }
  }
  return changed
}

export function registerMaps(server: any) {
  server.middlewares.use('/api/maps', (req, res) => {
    try {
      const cfg = loadConfig()
      const mapActivity = cfg.activities.find(a => a.type === 'map')
      if (!mapActivity) return sendError(res, 'No map activity configured', 500)
      const mc = mapActivity.config as { mapsDir: string }

      const urlPath = parseUrl(req).pathname.replace('/api/maps', '')
      const resolved = resolveDataPath(path.join(mc.mapsDir, urlPath))

      if (req.method === 'GET') {
        if (!fs.existsSync(resolved)) {
          // Listing a project whose mapsDir doesn't exist yet reads as an
          // empty list; a missing file underneath mapsDir is a 404 (the
          // statSync below used to throw ENOENT → a misleading 500).
          const isListing = urlPath === '' || urlPath === '/'
          return isListing ? sendJson(res, []) : sendError(res, 'File not found')
        }
        // Directory listing
        if (fs.statSync(resolved).isDirectory()) {
          const entries = fs.readdirSync(resolved).map(name => {
            const full = path.join(resolved, name)
            const stat = fs.statSync(full)
            const isDir = stat.isDirectory()
            // For a map dir, flag whether it has an authored tilemap and/or an
            // AI art-reference backdrop (source.png) — drives the list badge and
            // the "open backdrop → new from backdrop" flow.
            return isDir
              ? {
                  name, isDir, size: stat.size,
                  hasTilemap: fs.existsSync(path.join(full, 'map.tmx.json')),
                  hasBackdrop: fs.existsSync(path.join(full, 'source.png')),
                }
              : { name, isDir, size: stat.size }
          })
          return sendJson(res, entries)
        }
        // Binary assets (e.g. tileset.png) — serve raw, not as JSON.
        const ext = path.extname(resolved).toLowerCase()
        if (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.gif') {
          const mime = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : 'image/jpeg'
          res.writeHead(200, { 'Content-Type': mime })
          return res.end(fs.readFileSync(resolved))
        }
        // Text/JSON read (map.tmx.json, map.json, …).
        sendJson(res, JSON.parse(fs.readFileSync(resolved, 'utf-8')))
      } else if (req.method === 'PUT') {
        readBody(req).then(body => {
          fs.mkdirSync(path.dirname(resolved), { recursive: true })
          fs.writeFileSync(resolved, body, 'utf-8')
          sendJson(res, { ok: true })
        }).catch(e => sendError(res, (e as Error).message, 500))
      } else {
        return nextMiddleware(req, res)
      }
    } catch (e) {
      sendError(res, (e as Error).message, 500)
    }
  })

  // ── POST /api/maps — create a new map directory ──
  server.middlewares.use('/api/maps-create', async (req, res) => {
    if (req.method !== 'POST') return nextMiddleware(req, res)
    try {
      const { name } = JSON.parse(await readBody(req))
      // Same strict validation as maps-create-tmx/-delete/-rename: an
      // unvalidated name could escape mapsDir ('../x') or create a literal
      // "undefined/" dir.
      if (!name || !/^[A-Za-z0-9_-]+$/.test(String(name))) {
        return sendError(res, 'a valid map name (A–Z, 0–9, _-) is required', 400)
      }
      createMap(getProjectContext(), { name: String(name) })
      sendJson(res, { ok: true, name })
    } catch (e) {
      sendError(res, (e as Error).message, 500)
    }
  })

  // POST /api/maps-create-tmx — create a blank flat-per-tile Tiled map.
  //   body: { name, width, height } → <map>/map.tmx.json (ground + collision
  //   layers, all empty). tile size comes from the map activity config.
  server.middlewares.use('/api/maps-create-tmx', async (req, res) => {
    if (req.method !== 'POST') return nextMiddleware(req, res)
    try {
      const cfg = loadConfig()
      const mapAct = cfg.activities.find(a => a.type === 'map')
      if (!mapAct) return sendError(res, 'No map activity configured', 500)
      const mc = mapAct.config as { mapsDir: string; tileSize?: number }
      const { name, width, height } = JSON.parse(await readBody(req))
      if (!name || !/^[A-Za-z0-9_-]+$/.test(String(name))) {
        return sendError(res, 'a valid map name (A–Z, 0–9, _-) is required', 400)
      }
      const ts = mc.tileSize ?? 16
      const w = Math.max(1, Math.min(512, Math.floor(Number(width) || 20)))
      const h = Math.max(1, Math.min(512, Math.floor(Number(height) || 20)))
      const dir = resolveDataPath(path.join(mc.mapsDir, path.basename(String(name))))
      const tmxPath = path.join(dir, 'map.tmx.json')
      if (fs.existsSync(tmxPath)) return sendError(res, 'a map with that name already exists', 409)
      fs.mkdirSync(dir, { recursive: true })
      const blank = () => new Array(w * h).fill(0)
      const layer = (n: string) => ({
        name: n, width: w, height: h, visible: true, opacity: 1, type: 'tilelayer', data: blank(),
      })
      const tmx = {
        width: w, height: h, tilewidth: ts, tileheight: ts,
        backgroundcolor: '#101014',
        layers: [layer('ground'), layer('collision')],
      }
      fs.writeFileSync(tmxPath, JSON.stringify(tmx))
      sendJson(res, { ok: true, name })
    } catch (e) {
      sendError(res, (e as Error).message, 500)
    }
  })

  // POST /api/maps-delete — remove a map directory and all its files.
  //   body: { name } → recursively deletes <mapsDir>/<name>. Name is strictly
  //   validated (and basename-clamped) so the path can never escape mapsDir.
  server.middlewares.use('/api/maps-delete', async (req, res) => {
    if (req.method !== 'POST') return nextMiddleware(req, res)
    try {
      const cfg = loadConfig()
      const mapAct = cfg.activities.find(a => a.type === 'map')
      if (!mapAct) return sendError(res, 'No map activity configured', 500)
      const mc = mapAct.config as { mapsDir: string }
      const { name } = JSON.parse(await readBody(req))
      if (!name || !/^[A-Za-z0-9_-]+$/.test(String(name))) {
        return sendError(res, 'a valid map name (A–Z, 0–9, _-) is required', 400)
      }
      const dir = resolveDataPath(path.join(mc.mapsDir, path.basename(String(name))))
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
        return sendError(res, 'map not found', 404)
      }
      fs.rmSync(dir, { recursive: true, force: true })
      sendJson(res, { ok: true, name })
    } catch (e) {
      sendError(res, (e as Error).message, 500)
    }
  })

  // GET /api/maps-references?name=<name> — list every editor-managed reference to
  //   a map by name (warps, scenes, quests), so the UI can confirm before rename.
  server.middlewares.use('/api/maps-references', (req, res) => {
    if (req.method !== 'GET') return nextMiddleware(req, res)
    try {
      const name = parseUrl(req).searchParams.get('name')
      if (!name || !/^[A-Za-z0-9_-]+$/.test(name)) return sendError(res, 'a valid name is required', 400)
      sendJson(res, { ok: true, ...scanMapRefs(name) })
    } catch (e) {
      sendError(res, (e as Error).message, 500)
    }
  })

  // POST /api/maps-rename — rename a map directory. body: { name, newName, updateRefs? }.
  //   Both names are strictly validated + basename-clamped (can't escape mapsDir);
  //   refuses if the target already exists. When `updateRefs` is true, every
  //   editor-managed reference (warps / scenes / quests) is rewritten to the new
  //   name AFTER the move. NOT touched: runtime save files and the game's Rust
  //   `DEFAULT_START_MAP` constant.
  server.middlewares.use('/api/maps-rename', async (req, res) => {
    if (req.method !== 'POST') return nextMiddleware(req, res)
    try {
      const cfg = loadConfig()
      const mapAct = cfg.activities.find(a => a.type === 'map')
      if (!mapAct) return sendError(res, 'No map activity configured', 500)
      const mc = mapAct.config as { mapsDir: string }
      const { name, newName, updateRefs } = JSON.parse(await readBody(req))
      const ok = (s: unknown) => !!s && /^[A-Za-z0-9_-]+$/.test(String(s))
      if (!ok(name) || !ok(newName)) {
        return sendError(res, 'valid map names (A–Z, 0–9, _-) are required', 400)
      }
      const from = resolveDataPath(path.join(mc.mapsDir, path.basename(String(name))))
      const to = resolveDataPath(path.join(mc.mapsDir, path.basename(String(newName))))
      if (!fs.existsSync(from) || !fs.statSync(from).isDirectory()) {
        return sendError(res, 'map not found', 404)
      }
      if (from !== to && fs.existsSync(to)) {
        return sendError(res, 'a map with that name already exists', 409)
      }
      if (from !== to) fs.renameSync(from, to)
      // Rewrite references AFTER the move so the map's own moved scene is fixed too.
      const updated = (updateRefs && from !== to) ? rewriteMapRefs(String(name), String(newName)) : 0
      sendJson(res, { ok: true, name: newName, updated })
    } catch (e) {
      sendError(res, (e as Error).message, 500)
    }
  })

  server.middlewares.use('/api/maps/generate-backdrop', async (req, res) => {
    if (req.method !== 'POST') return nextMiddleware(req, res)
    try {
      const { mapName, prompt, profile, apiKey } = JSON.parse(await readBody(req))
      if (!profile || !apiKey) return sendError(res, 'profile and apiKey are required', 400)
      if (!mapName || !/^[A-Za-z0-9_-]+$/.test(String(mapName))) return sendError(res, 'invalid mapName', 400)
      if (!prompt || !String(prompt).trim()) return sendError(res, 'prompt is required', 400)
      // Shared with the assistant's generate_map_backdrop skill — same prompt
      // wrap + on-disk target, so the UI button and the chat agent never fork.
      const r = await generateMapBackdrop(getProjectContext(), String(mapName), String(prompt), makeGenImage(profile, apiKey))
      const abs = path.join(getProjectContext().root, r.rel)
      sendJson(res, { ok: true, base64: fs.readFileSync(abs).toString('base64'), width: r.width, height: r.height })
    } catch (e) {
      sendError(res, (e as Error).message, 500)
    }
  })

  function nextMiddleware(_req: IncomingMessage, res: ServerResponse) {
    res.writeHead(405); res.end('Method Not Allowed')
  }
}
