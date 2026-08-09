// Pixel-editor tool table + per-tool cursors (static data).

export const TOOLS = [
  { id: 'pencil', label: '铅笔', icon: '✏️', key: 'B' },
  { id: 'contour', label: '勾填笔', icon: '✒️', key: 'C' },
  { id: 'line', label: '直线', icon: '📏', key: 'L' },
  { id: 'rect', label: '矩形', icon: '▭', key: 'R' },
  { id: 'ellipse', label: '椭圆', icon: '◯', key: 'O' },
  { id: 'fill', label: '油漆桶', icon: '🪣', key: 'G' },
  { id: 'eyedropper', label: '吸管', icon: '💧', key: 'I' },
  { id: 'erase', label: '橡皮', icon: '🧽', key: 'E' },
  { id: 'stamp', label: '印章', icon: '🧩', key: 'S' },
  { id: 'select', label: '选区', icon: '⬚', key: 'M' },
  { id: 'lasso', label: '套索', icon: '🪢', key: 'Q' },
  { id: 'wand', label: '魔棒', icon: '🪄', key: 'W' },
  { id: 'move', label: '平移', icon: '✥', key: 'T' },
] as const
export type ToolId = (typeof TOOLS)[number]['id']

// ── per-tool cursors (data-URI SVG; hotspot at the tool's action point) ──
function svgCursor(svg: string, hx: number, hy: number, fallback: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hx} ${hy}, ${fallback}`
}

export const CURSORS: Record<ToolId, string> = {
  pencil: svgCursor(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path d="M4,20 L14,10 L17,13 L7,23 Z" fill="white" stroke="black" stroke-width="1.5"/><path d="M14,10 L17,7 L20,10 L17,13 Z" fill="gold" stroke="black" stroke-width="1.5"/></svg>`,
    4, 21, 'crosshair',
  ),
  // ink pen with a dark nib — paints outline + fill in one stroke
  contour: svgCursor(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path d="M4,20 L13,11 L16,14 L7,23 Z" fill="white" stroke="black" stroke-width="1.5"/><path d="M13,11 L17,7 L20,10 L16,14 Z" fill="#1c1c1c" stroke="black" stroke-width="1.5"/><path d="M4,20 L7,23 L4,23.5 Z" fill="#1c1c1c"/></svg>`,
    4, 21, 'crosshair',
  ),
  fill: svgCursor(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path d="M4,10 L11,3 L19,11 L12,18 Z" fill="white" stroke="black" stroke-width="1.5"/><path d="M19,12 C21,15 21,17 19,18 C17,17 17,15 19,12 Z" fill="dodgerblue" stroke="black" stroke-width="1"/></svg>`,
    11, 16, 'copy',
  ),
  eyedropper: svgCursor(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path d="M3,21 L4,17 L14,7 L17,10 L7,20 Z" fill="white" stroke="black" stroke-width="1.5"/><path d="M14,7 L17,4 A2,2 0 0 1 20,7 L17,10 Z" fill="gold" stroke="black" stroke-width="1.5"/></svg>`,
    3, 21, 'alias',
  ),
  erase: svgCursor(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect x="4" y="8" width="16" height="9" rx="2" fill="white" stroke="black" stroke-width="1.5"/><path d="M13,8 L13,17" stroke="black" stroke-width="1.2"/></svg>`,
    12, 12, 'cell',
  ),
  // shape tools share a centred crosshair (drawn from a corner / center)
  line: 'crosshair',
  rect: 'crosshair',
  ellipse: 'crosshair',
  select: 'crosshair',
  lasso: 'crosshair',
  wand: 'crosshair',
  stamp: 'copy', // place a whole library tile into a cell
  move: 'move', // 4-way arrows: drag the selection's pixels
}
