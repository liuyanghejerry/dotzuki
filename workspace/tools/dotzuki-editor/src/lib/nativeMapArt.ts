/** Optional native-resolution scenery. Coordinates stay in logical map pixels. */
export type ArtLayer = 'ground' | 'depth' | 'foreground'
export interface ArtComponent {
  image: string
  x: number
  y: number
  foot_y: number
  layer: ArtLayer
  [key: string]: unknown
}
export interface NativeMapArt {
  version: 1
  pixels_per_unit: number
  ground: string
  water_mask?: string
  components: ArtComponent[]
  [key: string]: unknown
}
export interface ArtGeometry {
  width: number
  height: number
  tilewidth: number
  tileheight: number
  collision: number[]
}
export interface ArtLibraryEntry { id: string; name: string; image: string }
export function validateArt(value: unknown): asserts value is NativeMapArt {
  const a = value as NativeMapArt
  const relative = (p: unknown) => typeof p === 'string' && p.length > 0
    && !p.startsWith('/') && !/[:\\\x00]/.test(p) && p.endsWith('.png')
  if (!a || a.version !== 1 || !Number.isInteger(a.pixels_per_unit)
    || a.pixels_per_unit < 1 || a.pixels_per_unit > 4) throw Error('Unsupported art version or density')
  if (!relative(a.ground) || (a.water_mask !== undefined && !relative(a.water_mask))) throw Error('Art images must be relative PNG paths')
  if (!Array.isArray(a.components)) throw Error('Art components must be an array')
  for (const c of a.components) {
    if (!c || !relative(c.image) || ![c.x, c.y, c.foot_y].every(Number.isSafeInteger)
      || !['ground', 'depth', 'foreground'].includes(c.layer)) throw Error('Invalid art component')
  }
}
export function artImagePaths(a: NativeMapArt): string[] {
  return [...new Set([a.ground, ...(a.water_mask ? [a.water_mask] : []), ...a.components.map(c => c.image)])]
}
/** Stable source order breaks ties, matching the runtime's depth sort. */
export function artDrawOrder(a: NativeMapArt): number[] {
  const rank = { ground: 0, depth: 1, foreground: 2 }
  return a.components.map((_, i) => i).sort((i, j) => {
    const x = a.components[i]!, y = a.components[j]!
    return rank[x.layer] - rank[y.layer] || (x.layer === 'depth' ? x.foot_y - y.foot_y : 0) || i - j
  })
}
/** Translating an object keeps its sorting anchor attached to its feet. */
export function moveArtComponent(c: ArtComponent, dx: number, dy: number): ArtComponent {
  return { ...c, x: c.x + dx, y: c.y + dy, foot_y: c.foot_y + dy }
}
export function artAssetUrl(name: string, image: string, revision = ''): string {
  return `api/map-art?${new URLSearchParams({ name, image, revision })}`
}
