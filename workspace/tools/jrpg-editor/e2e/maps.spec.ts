import { test, expect } from '@playwright/test'

// Map activity with the fixture project: a single map directory
// (data/maps/HomeTown/) that contains ONLY map.json — no map.tmx.json tilemap
// and no source.png backdrop. The suite asserts what the editor actually does
// with such an asset-less map: it is listed (badged "empty"), it opens in a
// sub-tab, and the canvas area falls back to the empty state instead of
// rendering tiles.

test.describe('map activity', () => {
  test('maps tab opens without an error and lists the fixture map', async ({ page }) => {
    await page.goto('/#/edit/maps')

    await expect(page.getByRole('heading', { name: 'Maps' })).toBeVisible()
    await expect(page.getByPlaceholder('Search maps')).toBeVisible()

    // The fixture map appears in the sidebar list...
    const aside = page.locator('aside').first()
    await expect(aside.getByRole('button', { name: /HomeTown/ })).toBeVisible()
    // ...badged "empty" because it has neither a tilemap nor a backdrop.
    await expect(aside.getByText('empty', { exact: true })).toBeVisible()

    // No error banner, and nothing is open yet.
    await expect(page.getByText('Failed to list maps')).toHaveCount(0)
    await expect(page.getByText('Select a map to edit').first()).toBeVisible()
  })

  test('opening the asset-less map shows a specific empty state (not the "select a map" placeholder)', async ({ page }) => {
    await page.goto('/#/edit/maps')
    const aside = page.locator('aside').first()
    await aside.getByRole('button', { name: /HomeTown/ }).click()

    // A sub-tab opens for the map: the sidebar entry plus the "🗺 HomeTown ×"
    // sub-tab button (the toolbar also shows the map name).
    await expect(page.getByRole('button', { name: /HomeTown/ })).toHaveCount(2)
    await expect(page.getByRole('button', { name: /🗺 HomeTown/ })).toBeVisible()

    // With no map.tmx.json and no source.png there is nothing to draw, so the
    // canvas stays hidden — but since a map IS open, the canvas area now says
    // so explicitly instead of showing the generic "select a map" placeholder.
    await expect(page.getByText('"HomeTown" has no tilemap or backdrop yet')).toBeVisible()
    await expect(page.getByText('Select a map from the sidebar')).toHaveCount(0)
    await expect(page.locator('canvas').first()).toBeHidden()

    // No error is surfaced for the missing assets.
    await expect(page.getByText('Failed to list maps')).toHaveCount(0)
  })
})
