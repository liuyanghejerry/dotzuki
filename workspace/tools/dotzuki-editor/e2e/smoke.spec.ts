import { test, expect } from '@playwright/test'

// Smoke: the editor boots against the fixture project, loads its config, and
// renders the activity nav from .dotzuki-editor.json.
test.describe('app shell', () => {
  test('loads project config and shows activities', async ({ page }) => {
    await page.goto('/')
    // Hash router redirects to /#/edit; config load selects the first activity.
    await expect(page).toHaveURL(/#\/edit/)
    await expect(page.locator('header')).toContainText('e2e-demo-game')
    const nav = page.locator('nav').first()
    await expect(nav.getByRole('button', { name: /Data/ })).toBeVisible()
    await expect(nav.getByRole('button', { name: /Scripts/ })).toBeVisible()
    await expect(nav.getByRole('button', { name: /Maps/ })).toBeVisible()
  })

  test('switches activities via the nav and updates the URL', async ({ page }) => {
    await page.goto('/')
    const nav = page.locator('nav').first()
    await nav.getByRole('button', { name: /Scripts/ }).click()
    await expect(page).toHaveURL(/#\/edit\/scripts/)
    await nav.getByRole('button', { name: /Maps/ }).click()
    await expect(page).toHaveURL(/#\/edit\/maps/)
  })
})
