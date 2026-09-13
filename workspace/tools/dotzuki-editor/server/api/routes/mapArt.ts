import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { PNG } from 'pngjs'
import { loadConfig, resolveDataPath } from '../projectConfig'
import { readBody, parseUrl, sendJson, sendError } from '../http'
import { validateArt, artImagePaths, type NativeMapArt, type ArtLibraryEntry } from '../../../src/lib/nativeMapArt'

const revision = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')
function containedFile(root: string, candidate: string): string {
  const real = fs.realpathSync(candidate)
  const rel = path.relative(fs.realpathSync(root), real)
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw Error('Asset is outside the project data root')
  return real
}
function validateImages(art: NativeMapArt, dir: string, root: string, map: any): void {
  const sizes = new Map<string, [number, number]>()
  for (const image of artImagePaths(art)) {
    const file = containedFile(root, path.resolve(dir, image))
    const png = PNG.sync.read(fs.readFileSync(file))
    if (png.width % art.pixels_per_unit || png.height % art.pixels_per_unit) throw Error('Image dimensions must align to density: ' + image)
    sizes.set(image, [png.width, png.height])
  }
  const expected = [map.width * map.tilewidth * art.pixels_per_unit, map.height * map.tileheight * art.pixels_per_unit]
  if (JSON.stringify(sizes.get(art.ground)) !== JSON.stringify(expected)) throw Error('Ground must cover the complete map at its art density')
  if (art.water_mask && JSON.stringify(sizes.get(art.water_mask)) !== JSON.stringify(expected)) throw Error('Water mask must match the ground dimensions')
}

/** Native scenery is saved separately from terrain, events, and collision. */
export function registerMapArt(server: any): void {
  server.middlewares.use('/api/map-art', async (req: any, res: any) => {
    try {
      const url = parseUrl(req), name = url.searchParams.get('name') ?? ''
      if (!/^[A-Za-z0-9_-]+$/.test(name)) return sendError(res, 'Invalid map name', 400)
      const cfg = loadConfig(), activity = cfg.activities.find(a => a.type === 'map')
      if (!activity) return sendError(res, 'No map activity configured', 400)
      const root = resolveDataPath(''), dir = resolveDataPath(path.join((activity.config as any).mapsDir, name))
      const mapFile = containedFile(root, path.join(dir, 'map.tmx.json'))
      const file = containedFile(root, path.join(dir, 'art.json'))
      const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'))
      const bytes = fs.readFileSync(file), currentRevision = revision(bytes)
      const current: unknown = JSON.parse(bytes.toString('utf8'))
      validateArt(current)
      const tiles = cfg.activities.find(a => (a.type as string) === 'tiles')
      const library: ArtLibraryEntry[] = []
      if (tiles) {
        const groups = resolveDataPath(path.join(String(tiles.config.tilesDir), 'groups'))
        const index = path.join(groups, 'groups.json')
        if (fs.existsSync(index)) for (const g of JSON.parse(fs.readFileSync(index, 'utf8')).groups ?? []) {
          if (typeof g.id !== 'string' || path.basename(g.id) !== g.id) continue
          library.push({ id: g.id, name: g.name || g.id, image: path.relative(dir, path.join(groups, g.id + '.png')).split(path.sep).join('/') })
        }
      }
      if (req.method === 'GET') {
        const image = url.searchParams.get('image')
        if (image !== null) {
          // Only images declared by this map are exposed, including sibling asset directories.
          if (!artImagePaths(current).includes(image) && !library.some(g => g.image === image)) return sendError(res, 'Image is not part of this map or its library', 404)
          const asset = containedFile(root, path.resolve(dir, image))
          res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' })
          return res.end(fs.readFileSync(asset))
        }
        validateImages(current, dir, root, map)
        const objectsFile = path.join(dir, 'objects.json')
        const objects = fs.existsSync(objectsFile) ? JSON.parse(fs.readFileSync(containedFile(root, objectsFile), 'utf8')) : {}
        return sendJson(res, { art: current, revision: currentRevision, library, objects, geometry: {
          width: map.width, height: map.height, tilewidth: map.tilewidth, tileheight: map.tileheight,
          collision: map.layers.find((l: any) => l.name === 'collision')?.data ?? [],
        } })
      }
      if (req.method === 'PUT') {
        const input = JSON.parse(await readBody(req))
        // Recheck after the asynchronous body read so concurrent saves cannot race.
        if (input.revision !== revision(fs.readFileSync(file))) return sendError(res, 'The art file changed on disk. Reload before saving.', 409)
        validateArt(input.art)
        validateImages(input.art, dir, root, map)
        const content = JSON.stringify(input.art, null, 2) + '\n'
        const temporary = path.join(dir, '.art-' + randomUUID() + '.tmp')
        try { fs.writeFileSync(temporary, content); fs.renameSync(temporary, file) }
        finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary) }
        return sendJson(res, { revision: revision(content) })
      }
      return sendError(res, 'Method not allowed', 405)
    } catch (e) { return sendError(res, (e as Error).message, 400) }
  })
}
