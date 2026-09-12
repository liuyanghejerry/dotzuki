import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { PNG } from 'pngjs'
import { resolveDataPath } from './api/projectConfig'
import { groupsRoot, mapsDirRel, readGroupsIndex, readTilesIndex, tilesIndexFile, tilesRoot } from './api/tilesPaths'

export interface PreparedComponent {
  groupId: string
  revision: string
  w: number
  h: number
  cells: number[]
}

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const identifier = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[\w-]+$/.test(value)) throw new Error('Invalid asset identifier')
  return value
}
const readJson = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'))

function copyCell(source: PNG, sx: number, sy: number, dest: PNG, dx: number, dy: number, size: number) {
  if (sx + size > source.width || sy + size > source.height) throw new Error('Tile outside source image')
  for (let y = 0; y < size; y++) {
    source.data.copy(dest.data, ((dy + y) * dest.width + dx) * 4,
      ((sy + y) * source.width + sx) * 4, ((sy + y) * source.width + sx + size) * 4)
  }
}

/** Prepare every file before replacing any destination; roll back a failed commit. */
function commitFiles(files: Map<string, Buffer>) {
  const pending: { file: string; temporary: string; original: Buffer | null }[] = []
  const committed: typeof pending = []
  try {
    for (const [file, bytes] of files) {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      const entry = { file, temporary: `${file}.${randomUUID()}.tmp`,
        original: fs.existsSync(file) ? fs.readFileSync(file) : null }
      pending.push(entry)
      fs.writeFileSync(entry.temporary, bytes)
    }
    for (const entry of pending) {
      fs.renameSync(entry.temporary, entry.file)
      committed.push(entry)
    }
  } catch (error) {
    for (const entry of committed.reverse()) {
      if (entry.original) fs.writeFileSync(entry.file, entry.original)
      else fs.rmSync(entry.file, { force: true })
    }
    throw error
  } finally {
    for (const entry of pending) fs.rmSync(entry.temporary, { force: true })
  }
}

/** Extend an atlas without changing any existing GID's pixels, including imported
 * atlases whose source tiles never existed in the shared library. No map cells
 * are written here: placement remains an undoable edit in the map editor. */
export function prepareComponents(mapName: unknown, groupIds: unknown) {
  const map = identifier(mapName)
  if (!Array.isArray(groupIds) || !groupIds.length || groupIds.length > 256) {
    throw new Error('Choose between 1 and 256 components')
  }
  const names = [...new Set(groupIds.map(identifier))]
  const dir = resolveDataPath(path.join(mapsDirRel(), map))
  const mapFile = path.join(dir, 'map.tmx.json')
  const tmx = readJson(mapFile)
  const size = tmx.tilewidth
  if (!Number.isInteger(size) || size < 1 || size > 256 || tmx.tileheight !== size) {
    throw new Error('Components require square map tiles between 1 and 256 pixels')
  }
  const atlasFile = path.join(dir, 'tileset.png')
  const seqFile = path.join(dir, 'tileset.tiles.json')
  const sequence = fs.existsSync(seqFile) ? readJson(seqFile) : {}
  const atlas = fs.existsSync(atlasFile) ? PNG.sync.read(fs.readFileSync(atlasFile)) : null
  if (atlas && (atlas.width % size || atlas.height % size)) throw new Error('Atlas dimensions do not match the tile grid')
  const cols = atlas ? atlas.width / size : (sequence.cols ?? 8)
  if (!Number.isInteger(cols) || cols < 1 || cols > 4096) throw new Error('Invalid atlas columns')
  const capacity = atlas ? (atlas.width / size) * (atlas.height / size) : 0
  const ids: string[] = sequence.tileIds === undefined
    ? Array.from({ length: capacity }, (_, i) => `imported-${map}-${i}`)
    : sequence.tileIds.map(identifier)
  const oldCount = ids.length
  if (atlas && oldCount > capacity) throw new Error('Atlas is missing pixels for existing tile IDs')
  const paintLayers = tmx.layers.filter((l: any) => !/^collision\d*$|^stairs$/.test(l.name))
  for (const layer of paintLayers) {
    if (!Array.isArray(layer.data)) continue
    for (const gid of layer.data) {
      if (!Number.isInteger(gid) || gid < 0 || gid > oldCount) throw new Error('Map references a missing or unsupported atlas tile')
    }
  }
  const catalog = readGroupsIndex()
  const fresh = new Map<string, PNG>()
  const prepared: PreparedComponent[] = []
  for (const groupId of names) {
    const group = catalog.groups.find(g => g.id === groupId)
    if (!group) throw new Error(`Component not found: ${groupId}`)
    const bytes = fs.readFileSync(path.join(groupsRoot(), `${groupId}.png`))
    const image = PNG.sync.read(bytes)
    if (!Number.isInteger(group.w) || !Number.isInteger(group.h) || group.w < 1 || group.h < 1
      || image.width !== group.w * size || image.height !== group.h * size) {
      throw new Error(`Component ${groupId} does not match this map's tile grid`)
    }
    const cells: number[] = []
    for (let y = 0; y < group.h; y++) {
      for (let x = 0; x < group.w; x++) {
        const tile = new PNG({ width: size, height: size })
        copyCell(image, x * size, y * size, tile, 0, 0, size)
        if (!tile.data.some((v, i) => i % 4 === 3 && v !== 0)) { cells.push(0); continue }
        const id = `${groupId}_${digest(tile.data).slice(0, 24)}`
        let index = ids.indexOf(id)
        if (index === -1) { index = ids.length; ids.push(id); fresh.set(id, tile) }
        cells.push(index + 1)
      }
    }
    prepared.push({ groupId, revision: digest(image.data), w: group.w, h: group.h, cells })
  }
  const output = new PNG({ width: cols * size, height: Math.max(1, Math.ceil(ids.length / cols)) * size })
  for (let i = 0; i < ids.length; i++) {
    const dx = (i % cols) * size, dy = Math.floor(i / cols) * size
    if (atlas && i < oldCount) {
      copyCell(atlas, dx, dy, output, dx, dy, size)
    } else {
      const source = fresh.get(ids[i]) ?? PNG.sync.read(fs.readFileSync(path.join(tilesRoot(), `${ids[i]}.png`)))
      if (source.width !== size || source.height !== size) throw new Error(`Invalid source tile: ${ids[i]}`)
      copyCell(source, 0, 0, output, dx, dy, size)
    }
  }
  const files = new Map<string, Buffer>()
  const library = readTilesIndex()
  for (const [id, tile] of fresh) {
    files.set(path.join(tilesRoot(), `${id}.png`), PNG.sync.write(tile))
    if (!library.tiles.some(t => t.id === id)) {
      const groupId = prepared.find(g => g.cells.includes(ids.indexOf(id) + 1))!.groupId
      library.tiles.push({ id, name: '', source: `group:${groupId}` })
    }
  }
  if (fresh.size) files.set(tilesIndexFile(), Buffer.from(JSON.stringify(library, null, 2) + '\n'))
  files.set(atlasFile, PNG.sync.write(output))
  files.set(seqFile, Buffer.from(JSON.stringify({ ...sequence, tileIds: ids, cols }, null, 2) + '\n'))
  commitFiles(files)
  return { components: prepared, tileIds: ids, cols }
}
