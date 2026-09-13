import { describe, expect, it } from 'vitest'
import { artDrawOrder, artImagePaths, moveArtComponent, validateArt, type NativeMapArt } from './nativeMapArt'

const sample = (): NativeMapArt => ({ version: 1, pixels_per_unit: 2, ground: '../../tiles/ground.png', components: [] })
describe('native scenery coordinates and ordering', () => {
  it('moves the foot anchor with the object while preserving authored metadata', () => {
    const c = { image: 'tree.png', x: 32, y: 48, foot_y: 96, layer: 'depth' as const, label: 'Ancient tree' }
    expect(moveArtComponent(c, -8, 17)).toEqual({ ...c, x: 24, y: 65, foot_y: 113 })
    expect(c.y).toBe(48)
  })
  it('keeps platforms below depth-sorted objects and foreground last, with stable ties', () => {
    const a = sample()
    a.components = [
      { image: 'canopy.png', x: 0, y: 0, foot_y: 0, layer: 'foreground' },
      { image: 'tree.png', x: 0, y: 0, foot_y: 80, layer: 'depth' },
      { image: 'bridge.png', x: 0, y: 0, foot_y: 500, layer: 'ground' },
      { image: 'pot.png', x: 0, y: 0, foot_y: 48, layer: 'depth' },
      { image: 'tree.png', x: 0, y: 0, foot_y: 80, layer: 'depth' },
    ]
    expect(artDrawOrder(a)).toEqual([2, 3, 1, 4, 0])
    expect(artImagePaths(a)).toHaveLength(5)
  })
  it.each([
    { pixels_per_unit: 0 }, { pixels_per_unit: 1.5 }, { version: 2 },
    { ground: 'https://outside/ground.png' }, { water_mask: '/absolute.png' },
    { components: [{ image: 'pot.png', x: 1.5, y: 0, foot_y: 0, layer: 'depth' }] },
    { components: [{ image: 'pot.png', x: 0, y: 0, foot_y: 0, layer: 'ui' }] },
  ])('rejects invalid runtime data %j', patch => expect(() => validateArt({ ...sample(), ...patch })).toThrow())
})
