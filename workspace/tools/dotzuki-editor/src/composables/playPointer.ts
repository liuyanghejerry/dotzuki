/** Bind primary taps to framebuffer pixels; CSS size may differ on each axis. */
export function bindPlayPointer(
  canvas: HTMLCanvasElement,
  click: (x: number, y: number) => void,
  cancel: () => void,
): () => void {
  let start: { id: number; x: number; y: number } | null = null
  const down = (e: PointerEvent) => {
    if (!e.isPrimary || e.button !== 0) { start = null; return }
    canvas.focus()
    start = { id: e.pointerId, x: e.clientX, y: e.clientY }
  }
  const move = (e: PointerEvent) => {
    if (start && (Math.abs(e.clientX - start.x) > 8 || Math.abs(e.clientY - start.y) > 8)) start = null
  }
  const leave = () => { start = null }
  const reset = () => { start = null; cancel() }
  const up = (e: PointerEvent) => {
    const tap = start
    start = null
    if (!tap || tap.id !== e.pointerId || !e.isPrimary || e.button !== 0 ||
      Math.abs(e.clientX - tap.x) > 8 || Math.abs(e.clientY - tap.y) > 8) return
    const rect = canvas.getBoundingClientRect()
    const x = (e.clientX - rect.left) * canvas.width / rect.width
    const y = (e.clientY - rect.top) * canvas.height / rect.height
    if (Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x < canvas.width && y < canvas.height) click(x, y)
  }
  canvas.addEventListener('pointerdown', down)
  canvas.addEventListener('pointermove', move)
  canvas.addEventListener('pointerup', up)
  canvas.addEventListener('pointercancel', reset)
  canvas.addEventListener('pointerleave', leave)
  canvas.addEventListener('blur', reset)
  window.addEventListener('blur', reset)
  return () => {
    canvas.removeEventListener('pointerdown', down)
    canvas.removeEventListener('pointermove', move)
    canvas.removeEventListener('pointerup', up)
    canvas.removeEventListener('pointercancel', reset)
    canvas.removeEventListener('pointerleave', leave)
    canvas.removeEventListener('blur', reset)
    window.removeEventListener('blur', reset)
    reset()
  }
}
