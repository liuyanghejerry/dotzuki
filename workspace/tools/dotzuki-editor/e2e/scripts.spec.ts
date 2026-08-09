import { test, expect } from '@playwright/test'

// Script activity: sidebar file list, CodeMirror loading, edit + save.
// The fixture has two scripts (intro.scene, town.scene); the editor
// auto-opens the first one (sorted listing) on mount. The edit test restores
// the original file content afterwards (via the API) so the shared scratch
// project stays pristine for the other specs in this serial run.

test.describe('script activity', () => {
  test('sidebar lists the scripts and the first one auto-loads', async ({ page }) => {
    await page.goto('/#/edit/scripts')

    // Sidebar buttons show the path without extension ("intro" / "town").
    await expect(page.getByRole('button', { name: 'intro', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'town', exact: true })).toBeVisible()
    await expect(page.getByText('2 files')).toBeVisible()

    // First file (alphabetical) loads automatically: header + CodeMirror.
    // (exact match — the file's own comment line also contains "intro.scene")
    await expect(page.getByText('intro.scene', { exact: true })).toBeVisible()
    await expect(page.locator('.cm-content')).toContainText('game_scene Intro')
  })

  test('selecting another script loads its content into the editor', async ({ page }) => {
    await page.goto('/#/edit/scripts')
    await expect(page.locator('.cm-content')).toContainText('game_scene Intro')

    await page.getByRole('button', { name: 'town', exact: true }).click()

    await expect(page.getByText('town.scene', { exact: true })).toBeVisible()
    const cm = page.locator('.cm-content')
    await expect(cm).toContainText('game_scene HomeTownAmbience')
    await expect(cm).not.toContainText('game_scene Intro')
  })

  test('editing and saving a script persists it to disk', async ({ page, request }) => {
    const original = await (await request.get('/api/scripts/intro.scene')).text()
    // Single-line replacement: avoids CodeMirror auto-indent on Enter, so the
    // typed text is byte-identical to what lands on disk.
    const replacement = '// e2e probe edit - restored after the test'

    await page.goto('/#/edit/scripts')
    const cm = page.locator('.cm-content')
    await expect(cm).toContainText('game_scene Intro')

    try {
      await cm.click()
      await page.keyboard.press('ControlOrMeta+A')
      await page.keyboard.type(replacement)
      await expect(cm).toContainText('e2e probe edit')

      // Dirty state enables the Save button; saving clears it again.
      const save = page.getByRole('button', { name: 'Save' })
      await expect(save).toBeEnabled()
      await save.click()
      await expect(save).toBeDisabled()
      await expect(page.getByText('Saved')).toBeVisible()

      // The new content persisted (endpoint serves the file as plain text).
      const persisted = await (await request.get('/api/scripts/intro.scene')).text()
      expect(persisted).toBe(replacement)
    } finally {
      // Restore the fixture content for the rest of the serial run.
      await request.put('/api/scripts/intro.scene', {
        data: original,
        headers: { 'Content-Type': 'text/plain' },
      })
    }
    expect(await (await request.get('/api/scripts/intro.scene')).text()).toBe(original)
  })
})
