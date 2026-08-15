import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Per-worktree E2E ports, so parallel checkouts (git worktrees, sibling clones)
// never fight over a fixed port: the default is derived from this checkout's
// absolute path (stable across runs, distinct across worktrees) and mapped into
// 21000–25999 — below the macOS/Linux ephemeral ranges, so no OS interference.
// E2E_PORT / E2E_PLAY_PORT still override explicitly; with only E2E_PORT set,
// the play server lands on the adjacent port. A rare hash collision between two
// worktrees fails loudly via Vite --strictPort rather than cross-serving.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function pathHash(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  return h >>> 0
}

export const port = Number(process.env.E2E_PORT ?? 21000 + (pathHash(root) % 5000))
export const playPort = Number(process.env.E2E_PLAY_PORT ?? port + 1)
