// Pure colour helpers shared by the pixel editor (no component state).

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

export function toHex(r: number, g: number, b: number): string {
  const h = (n: number) => n.toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

// Hue (0..360; -1 for greys so they cluster together) and perceived luminance —
// used to sort the working palette so near-duplicate 杂色 sit next to each other.
export function hexHue(hex: string): number {
  const [r, g, b] = hexToRgb(hex)
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  const d = mx - mn
  if (d === 0) return -1
  let h: number
  if (mx === r) h = ((g - b) / d) % 6
  else if (mx === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  h *= 60
  return h < 0 ? h + 360 : h
}

export function hexLum(hex: string): number {
  const [r, g, b] = hexToRgb(hex)
  return 0.299 * r + 0.587 * g + 0.114 * b
}

/** Darken a hex colour toward black by factor f (0..1). */
export function darken(hex: string, f = 0.4): string {
  const [r, g, b] = hexToRgb(hex)
  return toHex(Math.round(r * f), Math.round(g * f), Math.round(b * f))
}
