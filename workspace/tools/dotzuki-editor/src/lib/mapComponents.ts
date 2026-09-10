export interface PreparedComponent {
  groupId: string
  revision: string
  w: number
  h: number
  cells: number[]
}

export interface ComponentInstance extends PreparedComponent {
  x: number
  y: number
  underlay: number[]
  connectionSet?: string
}

export interface ComponentLayer {
  data: number[]
  components?: ComponentInstance[]
}

export function cloneComponents(layer: ComponentLayer): ComponentInstance[] {
  return (layer.components ?? []).map(c => ({ ...c, cells: [...c.cells], underlay: [...c.underlay] }))
}

/** Painting over an instance turns that instance into independently editable tiles. */
export function detachAt(layer: ComponentLayer, x: number, y: number) {
  if (!layer.components?.length) return
  layer.components = layer.components.filter(c => x < c.x || y < c.y || x >= c.x + c.w || y >= c.y + c.h)
}

export function placeComponent(layer: ComponentLayer, width: number, height: number,
  x: number, y: number, source: PreparedComponent, linked = true) {
  if (x < 0 || y < 0 || x + source.w > width || y + source.h > height) {
    throw new Error('The component must fit inside the map')
  }
  if (source.cells.length !== source.w * source.h) throw new Error('Invalid component footprint')
  const underlay: number[] = []
  for (let cy = 0; cy < source.h; cy++) {
    for (let cx = 0; cx < source.w; cx++) {
      const index = (y + cy) * width + x + cx
      underlay.push(layer.data[index] ?? 0)
      // Detach overlapping instances, even at transparent cells: each linked
      // footprint owns its underlay and must not conceal another live instance.
      detachAt(layer, x + cx, y + cy)
      const gid = source.cells[cy * source.w + cx]
      if (gid) layer.data[index] = gid
    }
  }
  if (linked) (layer.components ??= []).push({ ...source, cells: [...source.cells], x, y, underlay })
}

/** Refresh intact instances. Conflicts and resized sources retain their old
 * pixels and metadata until the author edits or places them again. */
export function refreshComponents(layer: ComponentLayer, width: number, height: number,
  sources: PreparedComponent[]) {
  const result = { updated: 0, conflicts: 0, resized: 0, missing: 0 }
  const byId = new Map(sources.map(s => [s.groupId, s]))
  for (const instance of layer.components ?? []) {
    const next = byId.get(instance.groupId)
    if (!next) { result.missing++; continue }
    if (next.w !== instance.w || next.h !== instance.h) { result.resized++; continue }
    if (next.revision === instance.revision) continue
    if (instance.cells.length !== instance.w * instance.h || instance.underlay.length !== instance.cells.length
      || instance.x < 0 || instance.y < 0 || instance.x + instance.w > width || instance.y + instance.h > height) {
      result.conflicts++; continue
    }
    const positions = instance.cells.map((_, i) => (instance.y + Math.floor(i / instance.w)) * width + instance.x + i % instance.w)
    if (positions.some((p, i) => layer.data[p] !== (instance.cells[i] || instance.underlay[i]))) {
      result.conflicts++; continue
    }
    positions.forEach((p, i) => { layer.data[p] = next.cells[i] || instance.underlay[i] })
    instance.cells = [...next.cells]
    instance.revision = next.revision
    result.updated++
  }
  return result
}
