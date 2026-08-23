// ───────────────────────────────────────────────────────────────────────────
// useProposals — a reusable review-tray store for `proposal` events. Shared by
// the chat assistant and the per-activity generate panels (e.g. data set-gen).
// Proposals are applied/reverted through /api/ai/apply-change; the agent never
// writes directly. Factory (not a singleton) so each surface owns its own tray.
// ───────────────────────────────────────────────────────────────────────────
import { ref } from 'vue'

export type DiffOp = { type: 'ctx' | 'add' | 'del'; text: string }

export interface AssistantProposal {
  uid: string
  target: any
  title: string
  rationale?: string
  diff: DiffOp[]
  /** File content the diff was computed against (null = the proposal creates the file). */
  before?: string | null
  after: string
  /** How applying mutates the target: 'write' (default) replaces the file with
   *  `after`; 'delete' removes it (map-tilemap deletes the whole artifact set). */
  op?: 'write' | 'delete'
  status: 'pending' | 'applied' | 'reverted' | 'failed' | 'conflict'
  backup?: string | null
  error?: string
}

async function apiApply(body: unknown): Promise<{ ok: boolean; backup: string | null; path: string; conflict?: boolean }> {
  const resp = await fetch('api/ai/apply-change', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const data = await resp.json()
  if (!resp.ok) throw new Error(data.error || 'apply failed')
  return data
}

/**
 * A review tray. Pass `persistKey` to survive page reloads via localStorage
 * (the chat assistant does; transient per-activity generators don't).
 */
export function useProposals(persistKey?: string) {
  const proposals = ref<AssistantProposal[]>(loadTray(persistKey))
  let seq = proposals.value.length
  const save = () => saveTray(persistKey, proposals.value)

  /** Append a proposal from a `proposal` event payload ({target,title,diff,before,after,op,…}). */
  function add(d: any): void {
    proposals.value.push({
      uid: `p${++seq}`, target: d.target, title: d.title, rationale: d.rationale,
      diff: Array.isArray(d.diff) ? d.diff : [], before: d.before ?? null, after: d.after ?? '',
      op: d.op ?? 'write', status: 'pending',
    })
    save()
  }

  function clear(): void { proposals.value = []; save() }

  /** Replace the whole tray (a chat-thread switch restores its snapshot).
   *  Re-seeds the uid counter past the highest restored uid so later additions
   *  never collide with an existing proposal. */
  function replace(list: AssistantProposal[]): void {
    proposals.value = list
    seq = list.reduce((n, p) => {
      const m = /^p(\d+)$/.exec(p?.uid ?? '')
      return m ? Math.max(n, Number(m[1])) : n
    }, list.length)
    save()
  }

  /** Apply a proposal. Sends the `before` it was built on so the server can
   *  refuse a stale write; `force` overrides that guard (used by "Apply anyway").
   *  `content` overrides the written text (used by per-hunk "Apply selected").
   *  A delete proposal (op:'delete') is applied verbatim — per-hunk subset
   *  content is never used for deletes. */
  async function applyProposal(p: AssistantProposal, opts: { force?: boolean; content?: string } = {}): Promise<void> {
    if (p.status === 'applied') return
    const op = p.op === 'delete' ? 'delete' : 'write'
    const after = opts.content ?? p.after
    try {
      const res = await apiApply({ target: p.target, op, after, expect: p.before ?? null, force: opts.force })
      if (res.conflict && !opts.force) { p.status = 'conflict'; p.backup = res.backup; p.error = undefined; return }
      p.backup = res.backup; p.status = 'applied'; p.error = undefined
    } catch (e: any) { p.status = 'failed'; p.error = e?.message || 'apply failed' }
    finally { save() }
  }

  /** Overwrite despite a detected drift (from the conflict banner). */
  function forceApply(p: AssistantProposal): Promise<void> { return applyProposal(p, { force: true }) }

  /** Apply only the selected hunks (by hunk index), reconstructing the file. */
  function applySubset(p: AssistantProposal, accepted: Set<number>): Promise<void> {
    return applyProposal(p, { content: applyHunks(p.diff, accepted) })
  }

  /** Apply every pending proposal, in order. `filter` skips proposals (the
   *  chat assistant uses it to keep meta operations manual-only). */
  async function applyAll(filter?: (p: AssistantProposal) => boolean): Promise<void> {
    for (const p of proposals.value) if (p.status === 'pending' && (!filter || filter(p))) await applyProposal(p)
  }

  async function revertProposal(p: AssistantProposal): Promise<void> {
    try {
      const body = p.backup == null ? { target: p.target, op: 'delete' } : { target: p.target, after: p.backup }
      await apiApply(body)
      p.status = 'reverted'; p.error = undefined
    } catch (e: any) { p.error = e?.message || 'revert failed' }
    finally { save() }
  }

  function discard(p: AssistantProposal): void {
    proposals.value = proposals.value.filter(x => x !== p)
    save()
  }

  return { proposals, add, clear, replace, applyProposal, forceApply, applySubset, applyAll, revertProposal, discard }
}

// ── per-hunk diff selection (pure, testable) ──────────────────────────────────

/** Group a line-diff into hunks: maximal runs of consecutive add/del ops,
 *  bounded by unchanged context. Returns each hunk as the list of its op indices. */
export function diffHunks(diff: DiffOp[]): number[][] {
  const hunks: number[][] = []
  let cur: number[] = []
  diff.forEach((op, i) => {
    if (op.type === 'ctx') { if (cur.length) { hunks.push(cur); cur = [] } }
    else cur.push(i)
  })
  if (cur.length) hunks.push(cur)
  return hunks
}

/**
 * Reconstruct the file content applying ONLY the accepted hunks. Context lines
 * are always kept; an accepted hunk takes its `after` side (adds in, dels out),
 * a rejected hunk keeps its `before` side (dels stay, adds dropped). Accepting
 * every hunk reproduces the full `after`; accepting none reproduces `before`.
 */
export function applyHunks(diff: DiffOp[], accepted: Set<number>): string {
  const opHunk = new Map<number, number>()
  diffHunks(diff).forEach((ops, h) => ops.forEach(i => opHunk.set(i, h)))
  const out: string[] = []
  diff.forEach((op, i) => {
    if (op.type === 'ctx') { out.push(op.text); return }
    const isAccepted = accepted.has(opHunk.get(i)!)
    if (op.type === 'add') { if (isAccepted) out.push(op.text) }
    else { if (!isAccepted) out.push(op.text) } // rejected del → keep the original line
  })
  return out.join('\n')
}

// ── localStorage persistence (browser only; no-op under node/test) ────────────
function loadTray(key?: string): AssistantProposal[] {
  if (!key || typeof localStorage === 'undefined') return []
  try { const s = localStorage.getItem(key); const v = s ? JSON.parse(s) : []; return Array.isArray(v) ? v : [] }
  catch { return [] }
}
function saveTray(key: string | undefined, list: AssistantProposal[]): void {
  if (!key || typeof localStorage === 'undefined') return
  try { localStorage.setItem(key, JSON.stringify(list)) } catch { /* quota / disabled — best effort */ }
}
