// ───────────────────────────────────────────────────────────────────────────
// The dotzuki-runner WASM playtest bridge (crates/dotzuki-runner-web, built by
// `pnpm build:wasm-runner` via wasm-pack --target web).
//
// Loading mirrors useWasmPreview: the import URL is built at runtime so Vite's
// import analyzer doesn't pre-resolve it — the request must reach the `/wasm`
// middleware (which falls back to crates/dotzuki-runner-web/pkg when a file isn't
// in dotzuki-web/pkg). The module is a module-level singleton cache.
//
// WASM contract (see crates/dotzuki-runner-web):
//   new WasmRunner(files_json, save_json?)  — files_json: {"<posix path>": "<base64>"}
//   tick(input_bitmask) → Uint8Array (320×240×4 RGBA)
//   take_audio() → Float32Array — interleaved stereo f32 (LRLR…) @ 44100Hz,
//                  drains the internal buffer (~738 frames/tick), empty while
//                  silent. Optional at runtime: pkgs built before audio
//                  support lack it — callers must feature-detect.
//   width()/height() → 320/240
//   export_save() → string | undefined,  import_save(json) → boolean
//   bitmask: bit0=A, bit1=B, bit2=Select, bit3=Start,
//            bit4=Right, bit5=Left, bit6=Up, bit7=Down
// ───────────────────────────────────────────────────────────────────────────

export interface WasmRunner {
  tick(inputBitmask: number): Uint8Array
  /** See the contract above — absent in pre-audio pkgs, hence optional. */
  take_audio?(): Float32Array
  width(): number
  height(): number
  export_save(): string | undefined
  import_save(json: string): boolean
  free(): void
}

interface WasmRunnerModule {
  default(): Promise<void>
  WasmRunner: new (filesJson: string, saveJson?: string | null) => WasmRunner
}

let wasmModule: WasmRunnerModule | null = null
let initPromise: Promise<WasmRunnerModule> | null = null

/** Load + init the runner WASM module (cached singleton; failures are retryable). */
export function loadRunnerModule(): Promise<WasmRunnerModule> {
  if (wasmModule) return Promise.resolve(wasmModule)
  if (initPromise) return initPromise
  initPromise = (async () => {
    try {
      // Resolve against the page URL (relative — works under any path prefix;
      // the hash fragment never participates in URL resolution).
      const wasmJsUrl = new URL('wasm/dotzuki_runner_web.js', window.location.href).href
      const mod = (await import(/* @vite-ignore */ wasmJsUrl)) as unknown as WasmRunnerModule
      await mod.default()
      wasmModule = mod
      return mod
    } catch (e) {
      // Allow a retry (e.g. after building the pkg) instead of caching the failure.
      initPromise = null
      throw new Error(
        `Failed to load the runner WASM: ${(e as Error).message} — ` +
          `please run \`pnpm build:wasm-runner\` first (crates/dotzuki-runner-web/pkg).`,
      )
    }
  })()
  return initPromise
}

export interface PlayBundle {
  files: Record<string, string>
  projectRoot: string
}

/** GET /api/play/bundle — throws an Error carrying the server's message on non-200. */
export async function loadBundle(): Promise<PlayBundle> {
  const res = await fetch('api/play/bundle')
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) msg = body.error
    } catch {
      /* keep the default message */
    }
    throw new Error(msg)
  }
  return (await res.json()) as PlayBundle
}

/** Construct a runner for a bundled project, optionally restoring a save. */
export async function createRunner(
  files: Record<string, string>,
  saveJson?: string | null,
): Promise<WasmRunner> {
  const mod = await loadRunnerModule()
  return new mod.WasmRunner(JSON.stringify(files), saveJson ?? null)
}

// Input bitmask bits (contract above).
export const BIT_A = 1 << 0
export const BIT_B = 1 << 1
export const BIT_SELECT = 1 << 2
export const BIT_START = 1 << 3
export const BIT_RIGHT = 1 << 4
export const BIT_LEFT = 1 << 5
export const BIT_UP = 1 << 6
export const BIT_DOWN = 1 << 7

/**
 * Map a keyboard event to its input bit (0 = unmapped).
 *
 * Arrows/Enter/Space/Backspace match on `key` (layout-independent values);
 * letters match on `code` (physical key position) so IMEs, Caps Lock, Shift
 * and non-QWERTY layouts never move the mapping off WASD/ZX.
 */
export function keyToBit(key: string, code = ''): number {
  switch (key) {
    case 'ArrowUp': return BIT_UP
    case 'ArrowDown': return BIT_DOWN
    case 'ArrowLeft': return BIT_LEFT
    case 'ArrowRight': return BIT_RIGHT
    case 'Enter': return BIT_START
    case 'Backspace': return BIT_SELECT
  }
  switch (code) {
    case 'KeyW': return BIT_UP
    case 'KeyA': return BIT_LEFT
    case 'KeyS': return BIT_DOWN
    case 'KeyD': return BIT_RIGHT
    case 'KeyZ': return BIT_A
    case 'KeyX': return BIT_B
    case 'Space': return BIT_START
    case 'ShiftRight': return BIT_SELECT
  }
  return 0
}
