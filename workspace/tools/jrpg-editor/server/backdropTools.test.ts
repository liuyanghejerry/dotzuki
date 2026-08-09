// backdropTools tests — the assistant's map/reference-image skills. Exercises
// the pure functions directly with an injected fake `genImage` (no AI call) and
// a hermetic temp fixture project.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createProjectContext } from './context/projectContext'
import { newImg, encodePNG, decodePNG, type Img } from './spriteSheet/image'
import {
  generateMapBackdrop, editMapBackdrop, traceBackdropToMap, generateTitleBackdrop,
} from './backdropTools'

let ROOT = ''
function write(rel: string, content: string | Buffer) {
  const abs = path.join(ROOT, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
}

/** A solid-color WxH image. */
function solid(w: number, h: number, r: number, g: number, b: number): Img {
  const img = newImg(w, h)
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255
  }
  return img
}

/** A 48×48 test backdrop: 3×3 grid of 16px tiles — red/green/blue, then a row
 *  with a red repeat + transparent + green repeat, then blue repeat + transparent
 *  + yellow. Unique tiles: red, green, blue, yellow = 4. */
function testBackdrop(): Img {
  const img = newImg(48, 48)
  const paint = (tx: number, ty: number, r: number, g: number, b: number) => {
    for (let y = ty * 16; y < ty * 16 + 16; y++) {
      for (let x = tx * 16; x < tx * 16 + 16; x++) {
        const i = (y * 48 + x) * 4
        img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255
      }
    }
  }
  paint(0, 0, 255, 0, 0)   // red
  paint(1, 0, 0, 255, 0)   // green
  paint(2, 0, 0, 0, 255)   // blue
  paint(0, 1, 255, 0, 0)   // red (dup)
  paint(2, 1, 0, 255, 0)   // green (dup)
  paint(0, 2, 0, 0, 255)   // blue (dup)
  paint(2, 2, 255, 255, 0) // yellow
  // (1,1) and (1,2) stay transparent
  return img
}

const fakeGen = (img: Img) => async (): Promise<Img> => img

beforeAll(() => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'jrpg-backdrop-'))
  write('.jrpg-editor.json', JSON.stringify({
    name: 'F', dataRoot: '.', activities: [
      { id: 'map', type: 'map', config: { mapsDir: 'data/maps', tileSize: 16 } },
      { id: 'tiles', type: 'tiles', config: { tilesDir: 'data/tiles' } },
      { id: 'title-screen', type: 'title-screen', config: {} },
    ],
  }))
})
afterAll(() => { try { fs.rmSync(ROOT, { recursive: true, force: true }) } catch { /* ignore */ } })

const project = () => createProjectContext(ROOT)

describe('generateMapBackdrop', () => {
  it('writes source.png from the injected generator and returns its size', async () => {
    const p = project()
    const r = await generateMapBackdrop(p, 'Town', 'a forest clearing', fakeGen(solid(64, 64, 1, 2, 3)))
    expect(r).toMatchObject({ map: 'Town', width: 64, height: 64 })
    const abs = path.join(ROOT, r.rel)
    expect(fs.existsSync(abs)).toBe(true)
    const dec = decodePNG(fs.readFileSync(abs))
    expect(dec.width).toBe(64)
    expect(dec.data[0]).toBe(1)
  })

  it('rejects an empty prompt and a bad map name', async () => {
    const p = project()
    await expect(generateMapBackdrop(p, 'Town', '   ', fakeGen(solid(8, 8, 0, 0, 0)))).rejects.toThrow(/prompt/)
    await expect(generateMapBackdrop(p, '../evil', 'x', fakeGen(solid(8, 8, 0, 0, 0)))).rejects.toThrow(/valid map name/)
  })
})

describe('editMapBackdrop', () => {
  it('edits the existing source.png and snaps back to the original size', async () => {
    const p = project()
    write('data/maps/Town/source.png', encodePNG(solid(32, 32, 9, 9, 9)))
    // Generator returns a different size — must be resampled back to 32×32.
    const r = await editMapBackdrop(p, 'Town', 'make it sunset', fakeGen(solid(64, 64, 200, 100, 50)))
    expect(r.width).toBe(32)
    expect(r.height).toBe(32)
    const dec = decodePNG(fs.readFileSync(path.join(ROOT, r.rel)))
    expect(dec.width).toBe(32)
  })

  it('errors when the map has no source.png yet', async () => {
    const p = project()
    await expect(editMapBackdrop(p, 'Nowhere', 'add a lake', fakeGen(solid(8, 8, 0, 0, 0)))).rejects.toThrow(/source\.png/)
  })
})

describe('traceBackdropToMap', () => {
  it('traces a 3×3 backdrop into a deduped tilemap (4 unique tiles)', () => {
    const p = project()
    write('data/maps/Town/source.png', encodePNG(testBackdrop()))
    const r = traceBackdropToMap(p, 'Town')
    expect(r).toMatchObject({ map: 'Town', width: 3, height: 3, tileSize: 16, tiles: 4 })

    // The ground layer maps each cell to its deduped GID; transparent cells are 0.
    const tmx = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/maps/Town/map.tmx.json'), 'utf-8'))
    expect(tmx.width).toBe(3); expect(tmx.height).toBe(3)
    expect(tmx.tilewidth).toBe(16); expect(tmx.tileheight).toBe(16)
    expect(tmx.layers.map((l: any) => l.name)).toEqual(['ground', 'collision'])
    expect(tmx.layers[0].data).toEqual([1, 2, 3, 1, 0, 2, 3, 0, 4])
    expect(tmx.layers[1].data.every((v: number) => v === 0)).toBe(true)

    // Tileset + tile library.
    expect(fs.existsSync(path.join(ROOT, 'data/maps/Town/tileset.png'))).toBe(true)
    const ts = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/maps/Town/tileset.tiles.json'), 'utf-8'))
    expect(ts.cols).toBe(16)
    expect(ts.tileIds).toEqual(['t0001', 't0002', 't0003', 't0004'])
    const lib = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/tiles/library.json'), 'utf-8'))
    expect(lib.tiles).toHaveLength(4)
    expect(lib.tiles[0].source).toBe('trace:Town')
    for (const id of ts.tileIds) {
      expect(fs.existsSync(path.join(ROOT, 'data/tiles', `${id}.png`))).toBe(true)
    }
    // Tileset is 16 cols × 1 row of 16px tiles.
    const sheet = decodePNG(fs.readFileSync(path.join(ROOT, 'data/maps/Town/tileset.png')))
    expect(sheet.width).toBe(16 * 16); expect(sheet.height).toBe(16)
  })

  it('quantize collapses flat regions into shared tiles', () => {
    const p = project()
    write('data/maps/Forest/source.png', encodePNG(testBackdrop()))
    const r = traceBackdropToMap(p, 'Forest', { quantize: true, colors: 8 })
    expect(r.tiles).toBeGreaterThan(0)
    expect(fs.existsSync(path.join(ROOT, 'data/maps/Forest/map.tmx.json'))).toBe(true)
  })

  it('refuses when the map already has an authored tilemap', () => {
    const p = project()
    write('data/maps/Town/source.png', encodePNG(testBackdrop()))
    write('data/maps/Town/map.tmx.json', '{"width":1,"height":1}')
    expect(() => traceBackdropToMap(p, 'Town')).toThrow(/already has an authored tilemap/)
  })

  it('errors when the map has no source.png', () => {
    const p = project()
    expect(() => traceBackdropToMap(p, 'Nowhere')).toThrow(/source\.png/)
  })

  it('errors when the project has no tiles activity', () => {
    const bareRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jrpg-backdrop-bare-'))
    try {
      write2(bareRoot, '.jrpg-editor.json', JSON.stringify({
        name: 'B', dataRoot: '.', activities: [
          { id: 'map', type: 'map', config: { mapsDir: 'data/maps' } },
        ],
      }))
      write2(bareRoot, 'data/maps/Town/source.png', encodePNG(testBackdrop()))
      expect(() => traceBackdropToMap(createProjectContext(bareRoot), 'Town')).toThrow(/tiles activity/)
    } finally { try { fs.rmSync(bareRoot, { recursive: true, force: true }) } catch { /* ignore */ } }
  })
})

function write2(root: string, rel: string, content: string | Buffer) {
  const abs = path.join(root, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
}

describe('generateTitleBackdrop', () => {
  it('writes the default title background path', async () => {
    const p = project()
    const r = await generateTitleBackdrop(p, 'an epic mountain vista', fakeGen(solid(128, 72, 5, 6, 7)))
    expect(r.rel).toBe('data/gfx/title/background.png')
    expect(fs.existsSync(path.join(ROOT, r.rel))).toBe(true)
  })

  it('honors the title activity bgImage config', async () => {
    const customRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jrpg-backdrop-title-'))
    try {
      write2(customRoot, '.jrpg-editor.json', JSON.stringify({
        name: 'T', dataRoot: '.', activities: [
          { id: 'title-screen', type: 'title-screen', config: { bgImage: 'gfx/title/bg.png' } },
        ],
      }))
      const r = await generateTitleBackdrop(createProjectContext(customRoot), 'ocean', fakeGen(solid(64, 36, 0, 0, 0)))
      expect(r.rel).toBe('gfx/title/bg.png')
      expect(fs.existsSync(path.join(customRoot, r.rel))).toBe(true)
    } finally { try { fs.rmSync(customRoot, { recursive: true, force: true }) } catch { /* ignore */ } }
  })
})
