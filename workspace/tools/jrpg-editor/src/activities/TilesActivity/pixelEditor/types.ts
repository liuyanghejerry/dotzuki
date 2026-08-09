// Shared pixel-editor layer types.

export type LayerKind = 'raster' | 'contour'

// How a 勾填笔 (contour) layer shades its silhouette between the outline and
// fill tones:
//  flat        — classic single dark edge + flat fill (default; unchanged)
//  ring        — fixed-width tone bands stepping inward from the edge, flat core
//  ramp        — bands scaled to the shape's depth: a full edge→center gradient
//  directional — gradient across the shape along a light direction (faux-3D)
export type ContourMode = 'flat' | 'ring' | 'ramp' | 'directional'

export interface Layer {
  id: string
  name: string
  kind: LayerKind
  data: Uint8ClampedArray // markRaw, pw*ph*4
  visible: boolean
  opacity: number // 0..255
  outline: string
  fill: string
  width: number
  mode: ContourMode // contour shading style (ignored for raster layers)
  levels: number // gradient band count for ring/ramp/directional (>= 2)
  angle: number // light direction in degrees, for directional mode
}
