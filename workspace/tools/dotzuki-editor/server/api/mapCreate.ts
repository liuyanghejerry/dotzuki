// ───────────────────────────────────────────────────────────────────────────
// createMap — lay out a new map directory with a minimal map.json. Shared by
// the /api/maps-create route and the assistant's map-create apply path so the
// on-disk shape never forks.
// ───────────────────────────────────────────────────────────────────────────
import path from 'path'
import fs from 'fs'
import type { ProjectContext } from '../context/projectContext'

export interface CreateMapParams {
  /** Map directory name under the map activity's mapsDir. */
  name: string
}

/** Create `<mapsDir>/<name>/` + a minimal map.json; returns the map dir. */
export function createMap(project: ProjectContext, params: CreateMapParams): { name: string; dir: string } {
  const mapActivity = project.config().activities.find(a => a.type === 'map')
  if (!mapActivity) throw new Error('No map activity configured')
  const mc = mapActivity.config as { mapsDir: string }

  const name = String(params.name)
  const dir = project.resolveData(path.join(mc.mapsDir, name))
  fs.mkdirSync(dir, { recursive: true })
  const mapJson = {
    name,
    width: 20, height: 18,
    tileset: '',
    music: '',
    warps: [], signs: [], npcs: [],
  }
  fs.writeFileSync(path.join(dir, 'map.json'), JSON.stringify(mapJson, null, 2), 'utf-8')
  return { name, dir }
}

export interface CreateMapTmxParams {
  name: string
  width: number
  height: number
}

/**
 * Write a blank flat-per-tile Tiled map (`map.tmx.json`) into a map dir:
 * ground + collision layers, all empty. Tile size comes from the map activity
 * config (default 16). Shared by the /api/maps-create-tmx route and the
 * assistant's map-create apply path so the on-disk shape never forks.
 */
export function createMapTmx(project: ProjectContext, params: CreateMapTmxParams): void {
  const mapActivity = project.config().activities.find(a => a.type === 'map')
  if (!mapActivity) throw new Error('No map activity configured')
  const mc = mapActivity.config as { mapsDir: string; tileSize?: number }
  const ts = mc.tileSize ?? 16
  const w = Math.max(1, Math.min(512, Math.floor(Number(params.width) || 20)))
  const h = Math.max(1, Math.min(512, Math.floor(Number(params.height) || 18)))
  const dir = project.resolveData(path.join(mc.mapsDir, String(params.name)))
  const tmxPath = path.join(dir, 'map.tmx.json')
  if (fs.existsSync(tmxPath)) throw new Error('a map with that name already has a tilemap')
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
}
