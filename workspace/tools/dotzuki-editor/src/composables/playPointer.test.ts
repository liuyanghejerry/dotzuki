import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindPlayPointer } from './playPointer'

class Canvas extends EventTarget {
  width = 320
  height = 240
  focus = vi.fn()
  getBoundingClientRect() { return { left: 100, top: 50, width: 640, height: 360 } }
}
function setup() {
  vi.stubGlobal('window', new EventTarget())
  const canvas = new Canvas()
  const click = vi.fn(), cancel = vi.fn()
  const dispose = bindPlayPointer(canvas as unknown as HTMLCanvasElement, click, cancel)
  const fire = (type: string, extra: Record<string, unknown> = {}) => {
    const event = new Event(type)
    Object.assign(event, { pointerId: 1, isPrimary: true, button: 0, clientX: 420, clientY: 230 }, extra)
    canvas.dispatchEvent(event)
  }
  return { canvas, click, cancel, dispose, fire }
}
afterEach(() => vi.unstubAllGlobals())
describe('play canvas pointer input', () => {
  it('maps independently scaled CSS coordinates and dispatches once on release', () => {
    const s = setup()
    s.fire('pointerdown'); expect(s.click).not.toHaveBeenCalled()
    s.fire('pointerup'); s.fire('pointerup')
    expect(s.click).toHaveBeenCalledExactlyOnceWith(160, 120)
    expect(s.canvas.focus).toHaveBeenCalledOnce()
    s.fire('pointerleave'); expect(s.cancel).not.toHaveBeenCalled()
  })
  it('rejects drag, secondary, multi-pointer, out-of-bounds and canceled gestures', () => {
    const s = setup()
    s.fire('pointerdown'); s.fire('pointermove', { clientX: 440 }); s.fire('pointerup')
    s.fire('pointerdown', { button: 2 }); s.fire('pointerup', { button: 2 })
    s.fire('pointerdown'); s.fire('pointerdown', { pointerId: 2, isPrimary: false }); s.fire('pointerup')
    s.fire('pointerdown', { clientX: 90 }); s.fire('pointerup', { clientX: 90 })
    s.fire('pointerdown'); s.fire('pointercancel'); s.fire('pointerup')
    s.fire('pointerdown'); s.fire('pointerleave'); s.fire('pointerup')
    expect(s.click).not.toHaveBeenCalled()
    expect(s.cancel).toHaveBeenCalledOnce()
  })
  it('focus loss cancels the route and disposing removes event handlers', () => {
    const s = setup()
    s.fire('pointerdown'); window.dispatchEvent(new Event('blur')); s.fire('pointerup')
    expect(s.click).not.toHaveBeenCalled()
    expect(s.cancel).toHaveBeenCalledOnce()
    s.dispose()
    s.fire('pointerdown'); s.fire('pointerup')
    expect(s.click).not.toHaveBeenCalled()
  })
})
