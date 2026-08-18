// @ts-nocheck -- Vite 8 middleware types changed; this is a config file, not app code
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { registerBuiltinActions } from './server/actions'
import { registerProject } from './server/api/routes/project'
import { registerData } from './server/api/routes/data'
import { registerContent } from './server/api/routes/content'
import { registerMaps } from './server/api/routes/maps'
import { registerTitle } from './server/api/routes/title'
import { registerTiles } from './server/api/routes/tiles'
import { registerGroups } from './server/api/routes/groups'
import { registerStories } from './server/api/routes/stories'
import { registerAi } from './server/api/routes/ai'
import { registerDsh } from './server/api/routes/dsh'
import { registerJobs } from './server/api/routes/jobs'
import { registerCv } from './server/api/routes/cv'
import { registerSprites } from './server/api/routes/sprites'
import { registerAssets } from './server/api/routes/assets'
import { registerAudio } from './server/api/routes/audio'
import { registerPlay } from './server/api/routes/play'

// ──────────────────────────────────────────────────────────────
// The editor is configured via a .dotzuki-editor.json file in the user's project
// root. The Vite dev server starts at that root and serves an /api/* surface
// (project config, data tables, scripts/gui, maps, tiles, building groups,
// stories/flags, AI, scheduled jobs, CV, sprites, and the asset browser). Those
// handlers were
// extracted into focused modules under server/api/; this file only registers
// them, in the original order. Shared dev-server state — the active project
// root and config cache — lives in server/api/projectConfig.ts; shared HTTP and
// path helpers live alongside it (http.ts, util.ts, tilesPaths.ts, storyPaths.ts).
// ──────────────────────────────────────────────────────────────

function apiPlugin() {
  return {
    name: 'dotzuki-editor-api',
    configureServer(server: any) {
      // Register the built-in AI actions (refine-character, generate-scene, …) so
      // /api/ai/run + the legacy shims can resolve them.
      registerBuiltinActions()

      // ── CORS — must be registered first; it matches all /api/* and falls through. ──
      server.middlewares.use('/api', (req, res, next) => {
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
        if (req.method === 'OPTIONS') {
          res.writeHead(204); res.end(); return
        }
        next()
      })

      // ── Domain routes — this order reproduces the original middleware sequence
      //    (connect matches on path-segment boundaries; only intra-domain order and
      //    "CORS first" actually matter, but we keep the full original order). ──
      registerProject(server)
      registerData(server)
      registerContent(server)
      registerMaps(server)
      registerTitle(server)
      registerTiles(server)
      registerGroups(server)
      registerStories(server)
      registerAi(server)
      registerDsh(server)
      registerJobs(server)
      registerCv(server)
      registerSprites(server)
      registerAssets(server)
      registerAudio(server)
      registerPlay(server)
    },
  }
}

export default defineConfig({
  plugins: [vue(), tailwindcss(), apiPlugin()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    port: 5174,
    // Don't auto-open a browser tab on start; open http://localhost:5174 yourself
    // (or pass `vite --open` for a one-off). Applies to dev/demo/pokered/wuxia.
    open: false,
    fs: {
      // In Vite 8, setting `allow` REPLACES the default workspace-root entry
      // instead of extending it — an explicit list without the project root
      // makes the dev server 403 the app's own src/ modules (the .vue activity
      // dynamic imports die with "outside of Vite serving allow list"). Include
      // the project root explicitly, then the extra dirs the app reads outside
      // it: the Help panel bundles `workspace/docs/reference/*.md` via `?raw`
      // imports, so the dev server must be allowed to serve those files too.
      allow: [
        path.resolve(__dirname, '.'),
        path.resolve(__dirname, '../../docs'),
      ],
    },
  },
})
