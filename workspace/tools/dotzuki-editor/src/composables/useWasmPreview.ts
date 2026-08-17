import { ref, type Ref } from 'vue'

// The generic dotzuki-web WASM bridge. `render_gui` is the game-agnostic entry:
// compiles `.gui` source, injects a theme, binds editor data, and rasterises at
// an arbitrary size (see crates/dotzuki-web/src/lib.rs).
interface WasmModule {
  default(): Promise<void>
  render_gui(
    source: string,
    width: number,
    height: number,
    theme_json: string,
    data_json: string,
    lang: number,
  ): Uint8Array
  compile_screen_source(source: string): string
}

let wasmModule: WasmModule | null = null
let initPromise: Promise<void> | null = null

export type CompileResult =
  | { ok: true; kind: 'screen'; json: string }
  | { ok: true; kind: 'components'; names: string[] }
  | { ok: false; error: string; line: number; col: number }

export interface WasmPreview {
  ready: Ref<boolean>
  error: Ref<string | null>
  /** Render `.gui` source to an RGBA buffer of `width*height*4` bytes. */
  renderGui: (
    source: string,
    width: number,
    height: number,
    theme: Record<string, unknown> | undefined,
    data: Record<string, unknown>,
    lang: number,
  ) => Promise<Uint8Array>
  /** Compile `.gui` source to schema-v2 JSON (for error reporting). */
  compileScreen: (source: string) => Promise<CompileResult>
}

export function useWasmPreview(): WasmPreview {
  const ready = ref(false)
  const error = ref<string | null>(null)

  async function ensureInit(): Promise<void> {
    if (wasmModule) return
    if (initPromise) return initPromise
    initPromise = (async () => {
      try {
        // Build the URL at runtime so Vite's import analyzer doesn't pre-resolve
        // it — the request must reach the `/wasm` middleware in vite.config.ts.
        const wasmJsUrl = new URL('/wasm/dotzuki_web.js', window.location.origin).href
        const mod = (await import(/* @vite-ignore */ wasmJsUrl)) as unknown as WasmModule
        await mod.default()
        wasmModule = mod
        ready.value = true
      } catch (e) {
        error.value = `Failed to load wasm: ${(e as Error).message}`
        throw e
      }
    })()
    return initPromise
  }

  async function renderGui(
    source: string,
    width: number,
    height: number,
    theme: Record<string, unknown> | undefined,
    data: Record<string, unknown>,
    lang: number,
  ): Promise<Uint8Array> {
    await ensureInit()
    const themeJson = theme ? JSON.stringify(theme) : ''
    const dataJson = JSON.stringify(data ?? {})
    return wasmModule!.render_gui(source, width, height, themeJson, dataJson, lang)
  }

  async function compileScreen(source: string): Promise<CompileResult> {
    await ensureInit()
    const raw = wasmModule!.compile_screen_source(source)
    try {
      const parsed = JSON.parse(raw)
      if (parsed.ok) {
        // A declarations-only component prelude (`component Foo { ... }`) is a
        // valid .gui file but has no screen to preview — surfaced as
        // kind 'components' so callers don't treat it as a compile error.
        if (parsed.kind === 'components') {
          return { ok: true, kind: 'components', names: parsed.names ?? [] }
        }
        return { ok: true, kind: 'screen', json: parsed.js ?? '' }
      }
      return { ok: false, error: parsed.error ?? 'compile error', line: parsed.line ?? 1, col: parsed.col ?? 1 }
    } catch (e) {
      return { ok: false, error: `bad compiler response: ${(e as Error).message}`, line: 1, col: 1 }
    }
  }

  return { ready, error, renderGui, compileScreen }
}
