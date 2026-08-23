// URL helpers for the editor frontend. The SPA can be served under an
// arbitrary path prefix (the cloud gateway mounts it at `/<session-id>/` and
// strips the prefix before proxying to the editor backend), so every URL the
// frontend emits must be RELATIVE to the page URL — never root-absolute.
// New code should build URLs through these helpers instead of hardcoding
// 'api/...' / 'gfx/...' / 'wasm/...' strings.

/** `apiUrl('maps')` → `api/maps` — the editor backend's /api surface. */
export const apiUrl = (p: string) => `api/${p}`

/** `gfxUrl('foo', 'sheet.png')` → `gfx/foo/sheet.png` — project gfx files. */
export const gfxUrl = (dir: string, name: string) => `gfx/${dir}/${name}`

/** Absolute URL for a file under the served `wasm/` dir (WASM pkg loaders). */
export const wasmUrl = (name: string) => new URL(`wasm/${name}`, window.location.href).href
