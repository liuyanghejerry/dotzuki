declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

declare module '@intlify/devtools-types' {
  export type IntlifyDevToolsEmitter = unknown
  export type IntlifyDevToolsHookPayloads = Record<string, unknown>
  export type IntlifyDevToolsHooks = string
  export type VueDevToolsEmitter = unknown
}

// Injected by the Electron preload (electron/preload.cjs). Absent in the plain
// browser build, so always feature-detect (`window.jrpgDesktop?.…`).
interface JrpgDesktopApi {
  readonly isElectron: true
  readonly platform: NodeJS.Platform
  /** Native folder picker → open a project; resolves { ok, path?, error? }. */
  openProject(): Promise<{ ok: boolean; path?: string; error?: string }>
  /** Native folder picker → parent dir for a new project; resolves { ok, path? }. */
  pickDirectory(): Promise<{ ok: boolean; path?: string }>
  /** Subscribe to the File → New Project… menu action. */
  onNewProject(cb: () => void): void
}
interface Window {
  jrpgDesktop?: JrpgDesktopApi
}
