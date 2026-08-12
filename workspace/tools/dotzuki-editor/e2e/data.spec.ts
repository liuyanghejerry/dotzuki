import { test, expect } from '@playwright/test'

// Data activity: sidebar table list, record browsing, detail panel, and the
// create / edit / delete flows. Tests use `e2e_`-prefixed record ids so they
// never collide with fixture records (hero / villager / potion), and every
// test cleans up any file it creates so the shared scratch project stays tidy
// for the other specs in this serial run.
//
// Regression coverage: the UI once derived API file names from the record id
// WITHOUT the ".json" extension (edits rejected by the duplicate-id guard,
// creates invisible to the *.json listing, deletes silently no-op). The fixed
// composable (src/composables/useDataActivity.ts) names files "<id>.json" and
// reuses the selected record's `_file`; these tests assert the correct flows.

test.describe('data activity', () => {
  test('sidebar lists tables; selecting one shows its records and count', async ({ page }) => {
    await page.goto('/#/edit/data')

    // Nothing selected yet → placeholder.
    await expect(page.getByText('Data Editor')).toBeVisible()

    // Both configured tables with their (localized) labels.
    const charactersTab = page.getByRole('button', { name: 'Characters' })
    const itemsTab = page.getByRole('button', { name: 'Items' })
    await expect(charactersTab).toBeVisible()
    await expect(itemsTab).toBeVisible()

    // Characters: 2 fixture records.
    await charactersTab.click()
    await expect(page.getByText('2 records').first()).toBeVisible()
    await expect(page.getByRole('row', { name: /Chen Mo/ })).toBeVisible()
    await expect(page.getByRole('row', { name: /Aunt Lin/ })).toBeVisible()

    // Items: 1 fixture record (singular form).
    await itemsTab.click()
    await expect(page.getByText('1 record').first()).toBeVisible()
    await expect(page.getByRole('row', { name: /Healing Salve/ })).toBeVisible()
  })

  test('selecting a record opens the detail panel with its fields', async ({ page }) => {
    await page.goto('/#/edit/data')
    await page.getByRole('button', { name: 'Characters' }).click()
    await page.getByRole('row', { name: /Chen Mo/ }).click()

    await expect(page.getByRole('heading', { name: 'Edit Record' })).toBeVisible()
    await expect(page.getByLabel('ID')).toHaveValue('hero')
    await expect(page.getByLabel('Name')).toHaveValue('Chen Mo')
    await expect(page.getByLabel('Element')).toHaveValue('Metal')
    await expect(page.getByLabel('HP')).toHaveValue('120')
    await expect(page.getByLabel('Description')).toHaveValue('The wandering swordsman.')
  })

  test('editing a record and saving persists the change to disk', async ({ page, request }) => {
    await page.goto('/#/edit/data')
    try {
      await page.getByRole('button', { name: 'Characters' }).click()
      await page.getByRole('row', { name: /Chen Mo/ }).click()

      const nameInput = page.getByLabel('Name')
      await expect(nameInput).toHaveValue('Chen Mo')
      await nameInput.fill('Chen Mo Edited')
      await page.getByRole('button', { name: 'Save' }).click()

      // The panel closes on a successful save and the row reflects the edit.
      await expect(page.getByRole('heading', { name: 'Edit Record' })).toBeHidden()
      await expect(page.getByRole('row', { name: /Chen Mo Edited/ })).toBeVisible()

      // The change reached disk via the record's real file name (hero.json).
      const resp = await request.get('/api/data/record/characters/hero.json')
      expect(resp.ok()).toBeTruthy()
      expect((await resp.json()).name).toBe('Chen Mo Edited')
    } finally {
      // Restore the fixture record so the shared scratch project stays tidy.
      await request.put('/api/data/save/characters/hero.json', {
        data: { id: 'hero', name: 'Chen Mo', element: 'Metal', hp: 120, description: 'The wandering swordsman.' },
      })
    }
  })

  test('creating a record adds a visible row and a .json file on disk', async ({ page, request }) => {
    const id = 'e2e_create_probe'
    try {
      await page.goto('/#/edit/data')
      await page.getByRole('button', { name: 'Characters' }).click()
      await expect(page.getByText('2 records').first()).toBeVisible()

      await page.getByRole('button', { name: 'New Record' }).click()
      await expect(page.getByRole('heading', { name: 'New Record' })).toBeVisible()
      await page.getByLabel('ID').fill(id)
      await page.getByLabel('Name').fill('E2E Create Probe')
      await page.getByRole('button', { name: 'Save' }).click()

      // Panel closes, the table refreshes with the new row.
      await expect(page.getByRole('heading', { name: 'New Record' })).toBeHidden()
      await expect(page.getByText('3 records').first()).toBeVisible()
      await expect(page.getByRole('row', { name: /E2E Create Probe/ })).toBeVisible()

      // On disk the record is "<id>.json" (listed by the *.json table query).
      const resp = await request.get(`/api/data/record/characters/${id}.json`)
      expect(resp.ok()).toBeTruthy()
      expect((await resp.json()).name).toBe('E2E Create Probe')
    } finally {
      await request.delete(`/api/data/delete/characters/${id}.json`)
    }
    expect((await request.get(`/api/data/record/characters/${id}.json`)).status()).toBe(404)
  })

  test('deleting a record removes it from the table and from disk', async ({ page, request }) => {
    const id = 'e2e_delete_probe'
    // Seed a record through the API.
    const seed = await request.put(`/api/data/save/characters/${id}.json`, {
      data: { id, name: 'E2E Delete Probe', element: 'Fire', hp: 10, description: '' },
    })
    expect(seed.ok()).toBeTruthy()

    try {
      await page.goto('/#/edit/data')
      await page.getByRole('button', { name: 'Characters' }).click()
      await expect(page.getByText('3 records').first()).toBeVisible()

      await page.getByRole('row', { name: /E2E Delete Probe/ }).click()
      await expect(page.getByRole('heading', { name: 'Edit Record' })).toBeVisible()
      await page.getByRole('button', { name: 'Delete' }).click()

      // Panel closes, the table loses the row...
      await expect(page.getByRole('heading', { name: 'Edit Record' })).toBeHidden()
      await expect(page.getByText('2 records').first()).toBeVisible()
      await expect(page.getByRole('row', { name: /E2E Delete Probe/ })).toHaveCount(0)

      // ...and the file is gone from disk.
      expect((await request.get(`/api/data/record/characters/${id}.json`)).status()).toBe(404)
    } finally {
      // In case the flow above failed mid-way, don't leak the probe record.
      await request.delete(`/api/data/delete/characters/${id}.json`)
    }
  })
})
