// Colour helpers — round-trips, known hues/luminance, darken factors.
import { describe, it, expect } from 'vitest'
import { hexToRgb, toHex, hexHue, hexLum, darken } from './colorUtils'

describe('hexToRgb', () => {
  it('parses 6-digit hex with or without the # prefix', () => {
    expect(hexToRgb('#ff0000')).toEqual([255, 0, 0])
    expect(hexToRgb('00ff00')).toEqual([0, 255, 0])
    expect(hexToRgb('#000000')).toEqual([0, 0, 0])
    expect(hexToRgb('#ffffff')).toEqual([255, 255, 255])
  })

  it('accepts mixed case', () => {
    expect(hexToRgb('#aB12cD')).toEqual([171, 18, 205])
  })
})

describe('toHex', () => {
  it('formats channels as two lowercase hex digits, zero-padded', () => {
    expect(toHex(255, 0, 0)).toBe('#ff0000')
    expect(toHex(0, 0, 0)).toBe('#000000')
    expect(toHex(255, 255, 255)).toBe('#ffffff')
    expect(toHex(1, 2, 3)).toBe('#010203')
  })

  it('round-trips with hexToRgb', () => {
    expect(toHex(...hexToRgb('#3c78b4'))).toBe('#3c78b4')
    expect(hexToRgb(toHex(12, 34, 56))).toEqual([12, 34, 56])
  })
})

describe('hexHue', () => {
  it('maps primaries and secondaries to their hue angles', () => {
    expect(hexHue('#ff0000')).toBe(0)
    expect(hexHue('#ffff00')).toBe(60)
    expect(hexHue('#00ff00')).toBe(120)
    expect(hexHue('#00ffff')).toBe(180)
    expect(hexHue('#0000ff')).toBe(240)
    expect(hexHue('#ff00ff')).toBe(300)
  })

  it('wraps negative hues back into 0..360', () => {
    expect(hexHue('#ff0080')).toBeCloseTo(329.88, 2)
  })

  it('returns -1 for greys so they cluster together', () => {
    expect(hexHue('#000000')).toBe(-1)
    expect(hexHue('#808080')).toBe(-1)
    expect(hexHue('#ffffff')).toBe(-1)
  })
})

describe('hexLum', () => {
  it('is 0 for black and 255 for white', () => {
    expect(hexLum('#000000')).toBe(0)
    expect(hexLum('#ffffff')).toBe(255)
  })

  it('weights green over red over blue', () => {
    expect(hexLum('#ff0000')).toBeCloseTo(76.245, 3)
    expect(hexLum('#00ff00')).toBeCloseTo(149.685, 3)
    expect(hexLum('#0000ff')).toBeCloseTo(29.07, 2)
    expect(hexLum('#00ff00')).toBeGreaterThan(hexLum('#ff0000'))
    expect(hexLum('#ff0000')).toBeGreaterThan(hexLum('#0000ff'))
  })
})

describe('darken', () => {
  it('scales channels toward black by the factor, rounding to ints', () => {
    expect(darken('#ff0000', 0.5)).toBe('#800000') // 127.5 rounds to 128
    expect(darken('#123456', 0.5)).toBe('#091a2b')
  })

  it('defaults to a 0.4 factor', () => {
    expect(darken('#ffffff')).toBe('#666666') // round(255 * 0.4) = 102
  })

  it('f=0 is black, f=1 is the identity', () => {
    expect(darken('#123456', 0)).toBe('#000000')
    expect(darken('#123456', 1)).toBe('#123456')
  })
})
