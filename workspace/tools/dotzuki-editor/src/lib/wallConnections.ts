import { cloneComponents, placeComponent, type ComponentLayer, type PreparedComponent } from './mapComponents'

/**
 * Cardinal bits: north=1, east=2, south=4, west=8.
 * Blob-mode corner bits: north-east=16, south-east=32, south-west=64,
 * north-west=128. Each variant is a 1×1 component.
 */
export interface ConnectionSet {
  id: string
  name: string
  /** `cardinal` keeps the 16-variant wall behavior used by older projects. */
  mode?: 'cardinal' | 'blob'
  variants: Record<string, string>
}
export interface ConnectionCell { x: number; y: number; solid: boolean }

const CARDINAL_MASKS = Array.from({ length: 16 }, (_, mask) => mask)

/** Remove corner bits whose two adjoining cardinal cells are not occupied. */
export function normalizeBlobMask(mask: number): number {
  let normalized = mask & 0x0f
  if ((mask & 0x10) && (mask & 0x01) && (mask & 0x02)) normalized |= 0x10
  if ((mask & 0x20) && (mask & 0x02) && (mask & 0x04)) normalized |= 0x20
  if ((mask & 0x40) && (mask & 0x04) && (mask & 0x08)) normalized |= 0x40
  if ((mask & 0x80) && (mask & 0x08) && (mask & 0x01)) normalized |= 0x80
  return normalized
}

/** The canonical 47 masks used by an eight-neighbor blob tileset. */
export const BLOB_MASKS = Array.from({ length: 256 }, (_, mask) => mask)
  .filter(mask => normalizeBlobMask(mask) === mask)

export function requiredConnectionMasks(mode: ConnectionSet['mode'] = 'cardinal'): number[] {
  return mode === 'blob' ? BLOB_MASKS : CARDINAL_MASKS
}

export function validateConnectionSets(value: unknown): ConnectionSet[] {
  if (!Array.isArray(value)) throw new Error('Connection sets must be an array')
  const ids = new Set<string>()
  for (const set of value) {
    if (!set || typeof set.id !== 'string' || !/^[\w-]+$/.test(set.id) || ids.has(set.id)
      || typeof set.name !== 'string') throw new Error('Invalid or duplicate connection set')
    if (set.mode !== undefined && set.mode !== 'cardinal' && set.mode !== 'blob') {
      throw new Error(`Connection set ${set.id} has an invalid mode`)
    }
    ids.add(set.id)
    for (const mask of requiredConnectionMasks(set.mode)) {
      if (typeof set.variants?.[mask] !== 'string' || !/^[\w-]+$/.test(set.variants[mask])) {
        throw new Error(`Connection set ${set.id} is missing variant ${mask}`)
      }
    }
  }
  return value
}

export function connectionMask(occupied: Set<number>, width: number, height: number,
  x: number, y: number, mode: ConnectionSet['mode'] = 'cardinal') {
  const cardinal = (y > 0 && occupied.has((y - 1) * width + x) ? 1 : 0)
    | (x + 1 < width && occupied.has(y * width + x + 1) ? 2 : 0)
    | (y + 1 < height && occupied.has((y + 1) * width + x) ? 4 : 0)
    | (x > 0 && occupied.has(y * width + x - 1) ? 8 : 0)
  if (mode !== 'blob') return cardinal

  // A diagonal only changes the tile when both adjoining cardinal cells exist.
  // This gating collapses the raw 256 combinations into the standard 47-tile
  // blob set and makes concave corners deterministic.
  let mask = cardinal
  if ((cardinal & 0x03) === 0x03 && occupied.has((y - 1) * width + x + 1)) mask |= 0x10
  if ((cardinal & 0x06) === 0x06 && occupied.has((y + 1) * width + x + 1)) mask |= 0x20
  if ((cardinal & 0x0c) === 0x0c && occupied.has((y + 1) * width + x - 1)) mask |= 0x40
  if ((cardinal & 0x09) === 0x09 && occupied.has((y - 1) * width + x - 1)) mask |= 0x80
  return mask
}

/** Build the stroke on a copy so a missing variant cannot partially paint a map. */
export function applyConnectionStroke(layer: ComponentLayer, width: number, height: number,
  set: ConnectionSet, sources: PreparedComponent[], changes: ConnectionCell[]) {
  validateConnectionSets([set])
  const byId = new Map(sources.map(s => [s.groupId, s]))
  for (const mask of requiredConnectionMasks(set.mode)) {
    const id = set.variants[mask]
    const source = byId.get(id)
    if (!source || source.w !== 1 || source.h !== 1 || source.cells.length !== 1 || !source.cells[0]) {
      throw new Error(`Connection variant ${id} must be a nonempty 1×1 component`)
    }
  }
  const work: ComponentLayer = { data: [...layer.data], components: cloneComponents(layer) }
  const occupied = new Set<number>()
  for (const instance of work.components ?? []) {
    if (instance.connectionSet !== set.id) continue
    const index = instance.y * width + instance.x
    if (instance.w === 1 && instance.h === 1 && instance.x >= 0 && instance.y >= 0
      && instance.x < width && instance.y < height && work.data[index] === instance.cells[0]) {
      occupied.add(index)
      work.data[index] = instance.underlay[0]
    }
    // Externally modified cells keep their pixels and cease to be linked walls.
  }
  work.components = work.components!.filter(c => c.connectionSet !== set.id)
  for (const {x,y,solid} of changes) {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= width || y >= height) continue
    const index = y * width + x
    if (solid) occupied.add(index)
    else occupied.delete(index)
  }
  for (const index of occupied) {
    const x = index % width, y = Math.floor(index / width)
    const mask = connectionMask(occupied, width, height, x, y, set.mode)
    placeComponent(work,width,height,x,y,byId.get(set.variants[mask])!)
    work.components![work.components!.length - 1].connectionSet = set.id
  }
  layer.data = work.data
  layer.components = work.components
}
