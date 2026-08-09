import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.E2E_PORT ?? 5199)
const playPort = Number(process.env.E2E_PLAY_PORT ?? 5200)

// E2E suite for the jrpg-editor SPA + its Vite-dev API surface. The webServer
// (e2e/serve.mjs) copies e2e/fixtures/demo-game to a scratch dir and starts
// Vite with JRPG_PROJECT_ROOT pointing at that copy, so mutations made by
// tests never touch the repo. A second server on playPort serves
// e2e/fixtures/playable-game for the Play-activity spec (play.spec.ts drives
// it via an absolute URL, not baseURL). Browsers come from the local
// Playwright cache (chromium-1228 matches @playwright/test 1.61) — no download
// needed; set E2E_CHROMIUM_PATH to point at a specific browser binary when the
// installed @playwright/test expects a different cache revision.
//
// Tests run serially: every spec shares the same dev server and scratch
// project, and several flows mutate project state on disk.
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: process.env.E2E_CHROMIUM_PATH
      ? { executablePath: process.env.E2E_CHROMIUM_PATH }
      : {},
  },
  webServer: [
    {
      command: 'node e2e/serve.mjs',
      port,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `JRPG_E2E_FIXTURE=playable-game E2E_PORT=${playPort} node e2e/serve.mjs`,
      port: playPort,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
