// @ts-nocheck -- extracted from vite.config.ts; loose dev-server types preserved
import path from 'path'
import fs from 'fs'
import { loadConfig, resolveDataPath } from './projectConfig'

export function tilesActivityConfig(): any {
  const cfg = loadConfig()
  const act = cfg.activities.find(a => a.type === 'tiles')
  if (!act) throw new Error('No tiles activity configured')
  return act.config
}
export function tilesRoot(): string {
  return resolveDataPath(tilesActivityConfig().tilesDir)
}
export function tilesIndexFile(): string {
  return path.join(tilesRoot(), 'library.json')
}
export function tilesLayersFile(id: string): string {
  return path.join(tilesRoot(), `${path.basename(String(id))}.layers.json`)
}
export function readTilesIndex(): { tiles: any[] } {
  const f = tilesIndexFile()
  if (!fs.existsSync(f)) return { tiles: [] }
  try { return JSON.parse(fs.readFileSync(f, 'utf-8')) } catch { return { tiles: [] } }
}

export function mapsDirRel(): string {
  const cfg = loadConfig()
  const act = cfg.activities.find(a => a.type === 'map')
  if (!act) throw new Error('No map activity configured')
  return (act.config as { mapsDir: string }).mapsDir
}

export function groupsRoot(): string { return path.join(tilesRoot(), 'groups') }
export function groupsIndexFile(): string { return path.join(groupsRoot(), 'groups.json') }
export function groupsLayersFile(id: string): string {
  return path.join(groupsRoot(), `${path.basename(String(id))}.layers.json`)
}
export function readGroupsIndex(): { groups: any[] } {
  const f = groupsIndexFile()
  if (!fs.existsSync(f)) return { groups: [] }
  try { return JSON.parse(fs.readFileSync(f, 'utf-8')) } catch { return { groups: [] } }
}