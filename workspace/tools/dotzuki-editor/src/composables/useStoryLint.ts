// ───────────────────────────────────────────────────────────────────────────
// Story validators — cross-check the narrative bible against itself and the
// game's scanned flag corpus. Pure function; no I/O.
// ───────────────────────────────────────────────────────────────────────────
import type { Character, Quest, StoryIssue } from '@/types'

export function computeIssues(
  characters: Character[],
  quests: Quest[],
  scannedFlags: string[],
): StoryIssue[] {
  const issues: StoryIssue[] = []
  const charIds = new Set(characters.map(c => c.id))
  const allSets = new Set(quests.flatMap(q => q.sets ?? []))
  const allRequires = new Set(quests.flatMap(q => q.requires ?? []))
  const scanned = new Set(scannedFlags)

  for (const q of quests) {
    const label = q.id || '(unnamed quest)'

    // A required flag that nothing sets — no quest sets it, and no scanned
    // game script touches it — so the quest can never become available. (The
    // flag scan covers setFlag(...) calls by default, so script-set flags
    // satisfy the requirement just like quest-set ones.)
    for (const f of q.requires ?? []) {
      if (!allSets.has(f) && !scanned.has(f)) {
        issues.push({
          severity: 'error',
          code: 'danglingRequire',
          message: `Quest "${label}" requires flag "${f}", but no quest or scanned script sets it.`,
          params: { quest: label, flag: f },
          kind: 'quests',
          recordId: q.id,
        })
      }
    }

    // A flag the quest sets that nothing reads (no quest requires it, no script uses it).
    for (const f of q.sets ?? []) {
      if (!allRequires.has(f) && !scanned.has(f)) {
        issues.push({
          severity: 'warn',
          code: 'orphanSet',
          message: `Quest "${label}" sets flag "${f}", but nothing requires or reads it yet.`,
          params: { quest: label, flag: f },
          kind: 'quests',
          recordId: q.id,
        })
      }
    }

    // Claims progress but has no implementing scene bound.
    if (q.status && q.status !== 'idea' && (q.implementedBy ?? []).length === 0) {
      issues.push({
        severity: 'warn',
        code: 'unimplemented',
        message: `Quest "${label}" is "${q.status}" but has no implementing scene bound.`,
        params: { quest: label, status: q.status },
        kind: 'quests',
        recordId: q.id,
      })
    }

    // Referenced characters that don't exist.
    if (q.giver && !charIds.has(q.giver)) {
      issues.push({
        severity: 'warn',
        code: 'unknownGiver',
        message: `Quest "${label}" giver "${q.giver}" is not a known character.`,
        params: { quest: label, giver: q.giver },
        kind: 'quests',
        recordId: q.id,
      })
    }
    for (const c of q.characters ?? []) {
      if (!charIds.has(c)) {
        issues.push({
          severity: 'warn',
          code: 'unknownCharRef',
          message: `Quest "${label}" references unknown character "${c}".`,
          params: { quest: label, char: c },
          kind: 'quests',
          recordId: q.id,
        })
      }
    }
  }

  // Character relationships pointing at non-existent characters.
  for (const ch of characters) {
    for (const r of ch.relationships ?? []) {
      if (r.to && !charIds.has(r.to)) {
        issues.push({
          severity: 'warn',
          code: 'unknownRelation',
          message: `Character "${ch.id}" has a relationship to unknown character "${r.to}".`,
          params: { char: ch.id, to: r.to },
          kind: 'characters',
          recordId: ch.id,
        })
      }
    }
  }

  return issues
}
