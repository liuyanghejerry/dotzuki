// Preload — the only bridge between the locked-down renderer and the main
// process. Exposes a tiny, explicit surface under window.jrpgDesktop; the app
// works without it (plain browser build), so every field is optional there.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('jrpgDesktop', {
  isElectron: true,
  platform: process.platform,
  /** Native folder picker → open a project; resolves { ok, path? , error? }. */
  openProject: () => ipcRenderer.invoke('jrpg:openProject'),
  /** Native folder picker → parent dir for a new project; resolves { ok, path? }. */
  pickDirectory: () => ipcRenderer.invoke('jrpg:pickDirectory'),
  /** Subscribe to the File → New Project… menu action. */
  onNewProject: (cb) => { ipcRenderer.on('jrpg:newProject', () => cb()) },
})
