// ──────────────────────────────────────────────────────────────────────────
// Electron main process for the Dotzuki Editor.
//
//   dev  (ELECTRON_DEV=1): the Vite dev server already serves the app + full
//        /api surface. We just point a window at it (ELECTRON_RENDERER_URL).
//   prod (packaged / preview): there is no Vite, so we start the bundled
//        api-server (dist-electron/api-server.mjs) — which serves dist/ AND the
//        same /api routes on one http origin — and load that URL.
//
// The renderer stays a locked-down web view (contextIsolation on, no node): it
// only ever talks to the local HTTP server, exactly like the browser build.
// ──────────────────────────────────────────────────────────────────────────
const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

// ELECTRON_PROD=1 forces the bundled-server path even when running unpackaged
// (used by `npm run electron:preview` to exercise the production flow).
const isDev =
  process.env.ELECTRON_PROD !== '1' &&
  (process.env.ELECTRON_DEV === '1' || !app.isPackaged)
const EDITOR_ROOT = path.resolve(__dirname, '..')

// Pin the editor root so bundled route handlers resolve scaffolding templates
// regardless of where the bundle physically lives.
if (!process.env.DOTZUKI_EDITOR_ROOT) process.env.DOTZUKI_EDITOR_ROOT = EDITOR_ROOT

// The WASM layout-preview pkg lives in the repo (crates/dotzuki-web/pkg) in dev and
// preview, but a packaged app has no repo — it ships the pkg as an extraResource
// (Resources/wasm-pkg). Point the /wasm route there. Unpackaged runs leave this
// unset so the route falls back to the in-repo path.
if (app.isPackaged && !process.env.DOTZUKI_WASM_ROOT) {
  process.env.DOTZUKI_WASM_ROOT = path.join(process.resourcesPath, 'wasm-pkg')
}

// Same story for the playtest runner pkg (crates/dotzuki-runner-web), shipped as
// Resources/wasm-runner-pkg; the /wasm route falls back to it.
if (app.isPackaged && !process.env.DOTZUKI_RUNNER_WASM_ROOT) {
  process.env.DOTZUKI_RUNNER_WASM_ROOT = path.join(process.resourcesPath, 'wasm-runner-pkg')
}

// And the nodejs-target dotzuki-web pkg (crates/dotzuki-web/pkg-node), shipped as
// Resources/wasm-node-pkg; sceneCheck's compile layer loads it from there.
if (app.isPackaged && !process.env.DOTZUKI_WASM_NODE_ROOT) {
  process.env.DOTZUKI_WASM_NODE_ROOT = path.join(process.resourcesPath, 'wasm-node-pkg')
}

// The dotzuki CLI + native player binaries ship as Resources/cli/* (staged from
// workspace/target/release; macOS release builds lipo them universal). The
// /api/export route shells out to the CLI (web export) and reuses the player
// binary via --player-bin (native export), since a packaged app has no cargo.
if (app.isPackaged && !process.env.DOTZUKI_CLI) {
  process.env.DOTZUKI_CLI = path.join(
    process.resourcesPath,
    'cli',
    process.platform === 'win32' ? 'dotzuki.exe' : 'dotzuki',
  )
}
if (app.isPackaged && !process.env.DOTZUKI_PLAYER) {
  process.env.DOTZUKI_PLAYER = path.join(
    process.resourcesPath,
    'cli',
    process.platform === 'win32' ? 'dotzuki-player.exe' : 'dotzuki-player',
  )
}

/** @type {import('http').Server extends any ? any : never} */
let apiServer = null // { url, port, close } from the prod api-server
/** @type {string} base origin the renderer + main talk to for /api */
let apiBase = ''
/** @type {BrowserWindow | null} */
let win = null

async function startProdServer() {
  const serverPath = path.join(EDITOR_ROOT, 'dist-electron', 'api-server.mjs')
  const { startApiServer } = await import(pathToFileURL(serverPath).href)
  const projectRoot = process.env.DOTZUKI_PROJECT_ROOT || process.cwd()
  apiServer = await startApiServer({
    projectRoot,
    staticDir: path.join(EDITOR_ROOT, 'dist'),
    host: '127.0.0.1',
    // Ephemeral by default; DOTZUKI_PORT pins it (handy for debugging/automation).
    port: Number(process.env.DOTZUKI_PORT) || 0,
  })
  return apiServer.url
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#f3f4f6', // matches the app's light bg-canvas (gray-100) shell
    title: 'Dotzuki Editor',
    // macOS: hide the native title bar but keep the traffic lights floating over
    // the app's own slim titlebar (the renderer provides the drag region and
    // leaves a left inset for the lights). Other platforms keep the standard
    // frame — the app has no custom window controls, so a hidden title bar
    // there would strand min/max/close.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 12, y: 14 } }
      : {}),
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  // Open target=_blank / external links in the system browser, not a new window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  win.loadURL(apiBase)
  if (isDev) win.webContents.openDevTools({ mode: 'detach' })
  win.on('closed', () => { win = null })
}

/** Native folder picker → switch the API's project root → reload the renderer. */
async function openProjectDialog() {
  const target = win ?? BrowserWindow.getFocusedWindow()
  const result = await dialog.showOpenDialog(target ?? undefined, {
    title: 'Open dotzuki project',
    message: 'Choose a folder containing .dotzuki-editor.json',
    properties: ['openDirectory'],
  })
  if (result.canceled || !result.filePaths[0]) return { ok: false }
  const dir = result.filePaths[0]
  try {
    // Reuse the existing /api/project/open route so dev (Vite) and prod
    // (bundled) servers switch roots through one code path.
    const resp = await fetch(`${apiBase}/api/project/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: dir }),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) {
      // 404 = no .dotzuki-editor.json — offer to scaffold a fresh project in place.
      if (resp.status === 404) {
        const { response } = await dialog.showMessageBox(target ?? undefined, {
          type: 'question',
          buttons: ['Cancel', 'Initialize Project'],
          defaultId: 1,
          cancelId: 0,
          title: 'Not a dotzuki project',
          message: 'This folder is not a dotzuki project.',
          detail: `Initialize a new project in ${dir}?`,
        })
        if (response !== 1) return { ok: false, error: data.error }
        const createResp = await fetch(`${apiBase}/api/project/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: path.basename(dir), template: 'empty', dir }),
        })
        const createData = await createResp.json().catch(() => ({}))
        if (!createResp.ok) {
          await dialog.showMessageBox(target ?? undefined, {
            type: 'error',
            title: 'Could not create project',
            message: createData.error || `Failed to initialize ${dir}`,
          })
          return { ok: false, error: createData.error }
        }
        win?.webContents.reload()
        return { ok: true, path: dir }
      }
      await dialog.showMessageBox(target ?? undefined, {
        type: 'error',
        title: 'Could not open project',
        message: data.error || `No .dotzuki-editor.json found in ${dir}`,
      })
      return { ok: false, error: data.error }
    }
    win?.webContents.reload()
    return { ok: true, path: dir }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

/** Native folder picker for a new project's parent directory (wizard "Browse…"). */
async function pickDirectoryDialog() {
  const target = win ?? BrowserWindow.getFocusedWindow()
  const result = await dialog.showOpenDialog(target ?? undefined, {
    title: 'Choose a parent folder',
    message: 'The new project will be created inside this folder',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (result.canceled || !result.filePaths[0]) return { ok: false }
  return { ok: true, path: result.filePaths[0] }
}

function buildMenu() {
  const isMac = process.platform === 'darwin'
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        // Opens the create-a-game wizard in the renderer (welcome screen).
        { label: 'New Project…', accelerator: 'CmdOrCtrl+N', click: () => win?.webContents.send('jrpg:newProject') },
        { label: 'Open Project…', accelerator: 'CmdOrCtrl+O', click: openProjectDialog },
        { type: 'separator' },
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => win?.webContents.reload() },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' }, { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// Single-instance: focus the existing window instead of spawning another.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus() }
  })

  app.whenReady().then(async () => {
    if (isDev) {
      apiBase = process.env.ELECTRON_RENDERER_URL || 'http://localhost:5174'
    } else {
      apiBase = await startProdServer()
    }

    ipcMain.handle('jrpg:openProject', openProjectDialog)
    ipcMain.handle('jrpg:pickDirectory', pickDirectoryDialog)
    buildMenu()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('will-quit', async () => {
    if (apiServer) await apiServer.close().catch(() => {})
  })
}
