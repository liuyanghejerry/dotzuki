import { test, expect, type Page } from '@playwright/test'

// Play activity: boots the WASM dotzuki-runner against the playable-game fixture
// (a scaffolded StartTown project) and verifies the game renders, responds to
// input, and persists a save to localStorage.
//
// Requires the runner wasm bundle (pnpm build:wasm-runner →
// crates/dotzuki-runner-web/pkg). The spec skips itself when it isn't built.
const playBase = `http://localhost:${process.env.E2E_PLAY_PORT ?? 5200}`

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

    // Save export runs on an interval and lands in localStorage.
    await page.waitForTimeout(2500)
    const saveKeys = await page.evaluate(() =>
      Object.keys(localStorage).filter(k => k.startsWith('dotzuki-play-save')),
    )
    expect(saveKeys.length).toBeGreaterThan(0)

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
