import fs from 'node:fs'
import path from 'node:path'
import { test, expect } from '@playwright/test'

// Smoke: the editor boots against the fixture project, loads its config, and
// renders the activity nav from .dotzuki-editor.json.
test.describe('app shell', () => {
  test('loads project config and shows activities', async ({ page }) => {
    await page.goto('/')
    // Hash router redirects to /#/edit; config load selects the first activity.
    await expect(page).toHaveURL(/#\/edit/)
    await expect(page.locator('header')).toContainText('Dotzuki Editor')
    await expect(page.locator('header')).toContainText('e2e-demo-game')
    await expect(page).toHaveTitle('Dotzuki Editor · e2e-demo-game')
    const nav = page.locator('nav').first()
    await expect(nav.getByRole('button', { name: /Data/ })).toBeVisible()
    await expect(nav.getByRole('button', { name: /Scripts/ })).toBeVisible()
    await expect(nav.getByRole('button', { name: /Maps/ })).toBeVisible()
  })

  test('opens a project through the browser folder picker', async ({ page, request }) => {
    const { projectRoot } = await (await request.get('/api/project/root')).json()
    const child = fs.mkdtempSync(path.join(projectRoot, 'picker-'))
    const config = { ...await (await request.get('/api/project')).json(), name: 'Selected game' }
    fs.writeFileSync(path.join(child, '.dotzuki-editor.json'), JSON.stringify(config))
    try {
      // Start at the welcome screen, as when the server's launch directory
      // contains games but has no manifest of its own.
      await page.route('**/api/project', route => route.fulfill({ status: 404, json: { error: 'No project open' } }), { times: 1 })
      await page.goto('/')
      await page.getByRole('button', { name: 'Open an existing project' }).click()
      await page.getByRole('button', { name: 'Browse…' }).click()
      await page.getByRole('button', { name: path.basename(child), exact: true }).click()
      await page.getByRole('button', { name: 'Open this project' }).click()
      await expect(page.locator('header')).toContainText('Selected game')
    } finally {
      await request.post('/api/project/open', { data: { path: projectRoot } })
      fs.rmSync(child, { recursive: true, force: true })
    }
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
