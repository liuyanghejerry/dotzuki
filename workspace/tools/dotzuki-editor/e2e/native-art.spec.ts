import { test, expect, type Page } from '@playwright/test'
import { PNG } from 'pngjs'

function image(width: number, height: number, color: number[]): Buffer {
  const png = new PNG({ width, height })
  for (let i = 0; i < png.data.length; i += 4) png.data.set(color, i)
  return PNG.sync.write(png)
}
async function openScenery(page: Page) {
  const geometry = { width: 8, height: 6, tilewidth: 16, tileheight: 16, collision: Array(48).fill(0) }
  geometry.collision[0] = 1
  let art = { version: 1, pixels_per_unit: 2, ground: 'ground.png', author: 'preserve',
    components: [{ image: 'tree.png', x: 16, y: 16, foot_y: 32, layer: 'depth', label: 'preserve object' }] }
  let revision = 'first', conflict = false
  const images: Record<string, Buffer> = { 'ground.png': image(256, 192, [70, 100, 60, 255]), 'tree.png': image(32, 64, [200, 90, 40, 255]), 'pot.png': image(32, 32, [80, 120, 170, 255]) }
  await page.route('**/api/maps', route => route.fulfill({ json: [{ name: 'HomeTown', isDir: true, hasTilemap: true, hasArt: true }] }))
  await page.route('**/api/maps/HomeTown/map.tmx.json', route => route.fulfill({ json: { ...geometry, layers: [{ name: 'ground', data: Array(48).fill(0), width: 8, height: 6 }, { name: 'collision', data: geometry.collision, width: 8, height: 6 }] } }))
  await page.route('**/api/map-art?**', async route => {
    const req = route.request(), url = new URL(req.url()), source = url.searchParams.get('image')
    if (source) return route.fulfill({ contentType: 'image/png', body: images[source]! })
    if (req.method() === 'PUT') {
      const body = req.postDataJSON()
      if (conflict || body.revision !== revision) return route.fulfill({ status: 409, json: { error: 'The art file changed on disk. Reload before saving.' } })
      art = body.art; revision += '-saved'; return route.fulfill({ json: { revision } })
    }
    return route.fulfill({ json: { art, revision, geometry, library: [{ id: 'pot', name: 'Pot', image: 'pot.png' }] } })
  })
  await page.goto('/#/edit/maps')
  await page.locator('aside').first().getByRole('button', { name: /HomeTown/ }).click()
  await page.getByTestId('open-native-art').click()
  await expect(page.getByTestId('art-canvas')).toHaveAttribute('width', '256')
  return { saved: () => art, conflict: () => { conflict = true } }
}

test('native scenery dragging, history, tab switching and saving preserve anchors', async ({ page }) => {
  const state = await openScenery(page), editor = page.getByTestId('native-art-editor')
  const canvas = page.getByTestId('art-canvas'), bounds = (await canvas.boundingBox())!
  await page.mouse.move(bounds.x + 40, bounds.y + 42); await page.mouse.down()
  await page.mouse.move(bounds.x + 72, bounds.y + 74); await page.mouse.up()
  await expect(page.getByTestId('art-x')).toHaveValue('32')
  await expect(page.getByTestId('art-y')).toHaveValue('32')
  await expect(page.getByTestId('art-foot')).toHaveValue('48')
  await expect(editor).toHaveAttribute('data-dirty', 'true')
  await page.getByTestId('art-undo').click()
  await expect(editor).toHaveAttribute('data-dirty', 'false')
  await editor.getByRole('button', { name: 'Redo', exact: true }).click()
  await page.getByRole('button', { name: /🗺 HomeTown/ }).click()
  await page.getByTestId('open-native-art').click()
  await expect(editor).toHaveAttribute('data-dirty', 'true')
  await page.getByTestId('art-save').click()
  await expect(editor).toHaveAttribute('data-dirty', 'false')
  expect(state.saved().author).toBe('preserve')
  expect(state.saved().components[0]).toMatchObject({ x: 32, y: 32, foot_y: 48, label: 'preserve object' })
  await editor.getByRole('button', { name: 'Reload from disk' }).click()
  await expect(editor).toHaveAttribute('data-dirty', 'false')
  await editor.locator('[data-art-index="0"]').click()
  await expect(page.getByTestId('art-foot')).toHaveValue('48')
  await page.getByTestId('art-y').fill('40')
  await page.getByTestId('art-y').press('Control+s')
  await expect(editor).toHaveAttribute('data-dirty', 'false')
  expect(state.saved().components[0]).toMatchObject({ y: 40, foot_y: 56 })
})

test('places library objects and keeps unsaved edits after a save conflict', async ({ page }) => {
  const state = await openScenery(page), editor = page.getByTestId('native-art-editor')
  await page.getByTestId('art-library').selectOption('pot.png')
  await page.getByTestId('art-add').click()
  await expect(editor.locator('[data-art-index]')).toHaveCount(2)
  await page.getByTestId('art-save').click()
  await expect(editor).toHaveAttribute('data-dirty', 'false')
  expect(state.saved().components[1]!.image).toBe('pot.png')
  await editor.getByRole('button', { name: 'Duplicate', exact: true }).click()
  state.conflict()
  await page.getByTestId('art-save').click()
  await expect(editor.getByRole('alert')).toContainText('changed on disk')
  await expect(editor).toHaveAttribute('data-dirty', 'true')
  expect(state.saved().components).toHaveLength(2)
  page.on('dialog', dialog => dialog.dismiss())
  await page.getByRole('button', { name: /HomeTown · Native scenery/ }).locator('span').click()
  await expect(editor).toBeVisible()
})
