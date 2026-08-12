import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { PNG } from 'pngjs'
import { copyDir, DEFAULT_SPRITE_CATEGORIES, pngSize } from './util'

/** Encode a real w×h RGBA PNG via pngjs (same codec as the sprite pipeline). */
function makePng(w: number, h: number): Buffer {
  const png = new PNG({ width: w, height: h })
  png.data = Buffer.alloc(w * h * 4)
  return PNG.sync.write(png)
}

describe('pngSize', () => {
  it('reads dimensions from a valid PNG', () => {
    expect(pngSize(makePng(24, 32))).toEqual({ w: 24, h: 32 })
    expect(pngSize(makePng(1, 1))).toEqual({ w: 1, h: 1 })
  })

  it('returns null for a buffer shorter than the IHDR header', () => {
    expect(pngSize(makePng(24, 32).subarray(0, 16))).toBeNull()
    expect(pngSize(Buffer.alloc(0))).toBeNull()
  })

  it('returns null when the IHDR magic is missing', () => {
    const buf = makePng(24, 32)
    buf.writeUInt32BE(0, 12) // clobber 'IHDR'
    expect(pngSize(buf)).toBeNull()
    expect(pngSize(Buffer.alloc(24))).toBeNull()
  })
})

describe('copyDir', () => {
  let tmp: string
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jrpg-util-'))
  })
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('recursively copies nested dirs and file contents', () => {
    const src = path.join(tmp, 'src')
    fs.mkdirSync(path.join(src, 'a', 'b'), { recursive: true })
    fs.writeFileSync(path.join(src, 'top.txt'), 'top')
    fs.writeFileSync(path.join(src, 'a', 'b', 'deep.txt'), '深')

    const dest = path.join(tmp, 'dest')
    copyDir(src, dest)

    expect(fs.readFileSync(path.join(dest, 'top.txt'), 'utf-8')).toBe('top')
    expect(fs.readFileSync(path.join(dest, 'a', 'b', 'deep.txt'), 'utf-8')).toBe('深')
  })

  it('is a no-op when src is missing: does not throw and does not create dest', () => {
    const dest = path.join(tmp, 'dest')
    expect(() => copyDir(path.join(tmp, 'nope'), dest)).not.toThrow()
    expect(fs.existsSync(dest)).toBe(false)
  })
})

describe('DEFAULT_SPRITE_CATEGORIES', () => {
  it('has unique ids', () => {
    const ids = DEFAULT_SPRITE_CATEGORIES.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives every category positive dimensions and a bilingual label', () => {
    for (const c of DEFAULT_SPRITE_CATEGORIES) {
      expect(c.rows).toBeGreaterThan(0)
      expect(c.cols).toBeGreaterThan(0)
      expect(c.cellW).toBeGreaterThan(0)
      expect(c.cellH).toBeGreaterThan(0)
      expect(c.label.en.length).toBeGreaterThan(0)
      expect(c.label.zh.length).toBeGreaterThan(0)
    }
  })

  it('keeps the overworld stand/walk/run columns inside the grid', () => {
    const ow = DEFAULT_SPRITE_CATEGORIES.find((c) => c.id === 'overworld') as unknown as {
      cols: number
      standCol: number
      walkCols: number[]
      runCols: number[]
    }
    expect(ow).toBeDefined()
    for (const col of [ow.standCol, ...ow.walkCols, ...ow.runCols]) {
      expect(col).toBeGreaterThanOrEqual(0)
      expect(col).toBeLessThan(ow.cols)
    }
  })
})
