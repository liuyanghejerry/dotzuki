import { writeFile } from 'node:fs/promises'
import { test, expect, type Page } from '@playwright/test'

// Play activity: boots the WASM dotzuki-runner against the playable-game fixture
// (a scaffolded StartTown project) and verifies the game renders, responds to
// input, and persists a save to localStorage.
//
// Requires the runner wasm bundle (pnpm build:wasm-runner →
// crates/dotzuki-runner-web/pkg). The spec skips itself when it isn't built.
import { playPort } from './ports'

const playBase = `http://localhost:${playPort}`

/** Sum + sampled distinct colors of the play canvas, to detect frame changes. */
function sampleFrame(page: Page) {
  return page.evaluate(() => {
    const c = document.querySelector('canvas[tabindex]') as HTMLCanvasElement
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
    let sum = 0
    const colors = new Set<string>()
    for (let i = 0; i < d.length; i += 4) {
      sum += d[i] + d[i + 1] + d[i + 2]
      if (i % 4000 === 0) colors.add(`${d[i]},${d[i + 1]},${d[i + 2]}`)
    }
    return { w: c.width, h: c.height, sum, distinct: colors.size }
  })
}

test.describe('play activity (wasm runner)', () => {
  test('boots the game, responds to input and persists a save', async ({ page, request }) => {
    test.setTimeout(120_000)
    test.skip(
      (await request.get(`${playBase}/wasm/dotzuki_runner_web.js`)).status() === 404,
      'runner wasm not built — run pnpm build:wasm-runner',
    )

    await page.goto(`${playBase}/#/edit/play`)
    const canvas = page.locator('canvas[tabindex]')
    // The dev-built wasm is ~18MB; boot can take a while on cold cache.
    await canvas.waitFor({ state: 'visible', timeout: 120_000 })

    // First rendered frame: real game content, not a blank canvas.
    let first = await sampleFrame(page)
    for (let i = 0; i < 40 && !(first.sum > 0 && first.distinct > 2); i++) {
      await page.waitForTimeout(500)
      first = await sampleFrame(page)
    }
    expect([first.w, first.h]).toEqual([320, 240])
    expect(first.distinct).toBeGreaterThan(2)

    // Game language is independent from the editor UI language. Changing it
    // reboots the WASM runner and is reflected in the runner-owned save.
    const language = page.getByTestId('play-language')
    await language.selectOption('zh')
    await expect(language).toHaveValue('zh')
    await page.waitForTimeout(500)

    // Advance the intro dialogue with A (KeyZ). Holds are deliberate: a ~0ms
    // down/up tap can fall between two game ticks and be lost, same as the
    // native shell.
    await canvas.click()
    const tap = async (key: string) => {
      await page.keyboard.down(key)
      await page.waitForTimeout(120)
      await page.keyboard.up(key)
      await page.waitForTimeout(180)
    }
    for (let i = 0; i < 8; i++) await tap('KeyZ')
    const afterDialogue = await sampleFrame(page)
    expect(afterDialogue.sum).not.toBe(first.sum)

    // Walk: the overworld frame must change again.
    await page.keyboard.down('ArrowRight')
    await page.waitForTimeout(600)
    await page.keyboard.up('ArrowRight')
    await page.keyboard.down('ArrowDown')
    await page.waitForTimeout(600)
    await page.keyboard.up('ArrowDown')
    const afterMove = await sampleFrame(page)
    expect(afterMove.sum).not.toBe(afterDialogue.sum)

    // Save export runs on an interval and lands in localStorage. Poll instead
    // of sleeping so cold CI runners only wait as long as necessary.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const key = Object.keys(localStorage).find(k => k.startsWith('dotzuki-play-save'))
            const raw = key ? localStorage.getItem(key) : null
            return raw ? JSON.parse(raw).lang : null
          }),
        { timeout: 10_000 },
      )
      .toBe('zh')

    // Audio: the fixture's StartTown scene plays "TownTheme" on boot, the wasm
    // runner renders PCM per tick, and the WebAudio graph starts consuming it
    // once a user gesture (the canvas click above) resumes the AudioContext.
    const audio = await page.evaluate(() => (window as any).__playAudio)
    expect(audio, 'play-audio stats should be exposed').toBeTruthy()
    expect(audio.samplesPushed).toBeGreaterThan(0)
    await expect
      .poll(async () => (await page.evaluate(() => (window as any).__playAudio)).samplesPlayed, {
        timeout: 5000,
      })
      .toBeGreaterThan(0)
  })
})

// Scenarios: primary click walks to its tile after CSS scaling; dragging does
// not replace the destination; keyboard direction takes ownership; menu blocks clicks.
test('click navigation works at desktop and narrow canvas sizes', async ({ page, request }, testInfo) => {
  test.setTimeout(120_000)
  expect((await request.get(`${playBase}/wasm/dotzuki_runner_web.js`)).ok()).toBeTruthy()
  await page.goto(`${playBase}/#/edit/play`)
  const canvas = page.locator('canvas[tabindex]')
  await canvas.waitFor({ state: 'visible', timeout: 60_000 })
  await canvas.focus()
  const tap = async (key: string) => {
    await page.keyboard.down(key)
    await page.waitForTimeout(80)
    await page.keyboard.up(key)
    await page.waitForTimeout(100)
  }
  for (let i = 0; i < 8; i++) await tap('KeyZ')
  const savedTile = () => page.evaluate(() => {
    const key = Object.keys(localStorage).find(k => k.startsWith('dotzuki-play-save'))
    const save = key && localStorage.getItem(key)
    if (!save) return null
    const player = JSON.parse(save).player
    return [player.x, player.y]
  })
  await expect.poll(savedTile, { timeout: 10_000 }).toEqual([12, 10])
  // Camera follows the player's tile center, clamped to this 384x320 map.
  const clickTile = async (from: number[], to: number[]) => {
    const box = (await canvas.boundingBox())!
    const cameraX = Math.max(0, Math.min(64, from[0] * 16 + 8 - 160))
    const cameraY = Math.max(0, Math.min(80, from[1] * 16 + 8 - 120))
    await page.mouse.click(box.x + (to[0] * 16 + 8 - cameraX) * box.width / 320,
      box.y + (to[1] * 16 + 8 - cameraY) * box.height / 240)
  }
  // Capture the first marked frame in the draw callback, so a slow CI browser
  // cannot miss a route that finishes before the next automation round-trip.
  await canvas.evaluate((c: HTMLCanvasElement) => {
    const ctx = c.getContext('2d')!
    const draw = ctx.putImageData.bind(ctx)
    ctx.putImageData = (frame: ImageData, x: number, y: number) => {
      draw(frame, x, y)
      const rgba = frame.data
      for (let i = 0; i < rgba.length; i += 4) {
        if (rgba[i] === 255 && rgba[i + 1] === 230 && rgba[i + 2] === 100) {
          c.dataset.destinationPng = c.toDataURL('image/png')
          ctx.putImageData = draw
          break
        }
      }
    }
  })
  await clickTile([12, 10], [8, 10])
  await expect.poll(() => canvas.getAttribute('data-destination-png'), { timeout: 5000 }).toBeTruthy()
  const destinationPng = (await canvas.getAttribute('data-destination-png'))!
  await writeFile(testInfo.outputPath('click-destination.png'), Buffer.from(destinationPng.split(',')[1], 'base64'))
  await expect.poll(savedTile, { timeout: 10_000 }).toEqual([8, 10])
  // A drag ending at another tile must not launch a route.
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * .7, box.y + box.height * .5, { steps: 4 })
  await page.mouse.up()
  await page.waitForTimeout(2200)
  expect(await savedTile()).toEqual([8, 10])
  await page.setViewportSize({ width: 760, height: 1000 })
  await clickTile([8, 10], [10, 12])
  await expect.poll(savedTile, { timeout: 10_000 }).toEqual([10, 12])
  await canvas.screenshot({ path: testInfo.outputPath('click-arrived-narrow.png') })
  // Start opens the menu. Clicks must not queue movement to run after closing.
  await tap('Enter')
  await clickTile([10, 12], [8, 10])
  await tap('KeyX')
  await page.waitForTimeout(2200)
  expect(await savedTile()).toEqual([10, 12])
})
