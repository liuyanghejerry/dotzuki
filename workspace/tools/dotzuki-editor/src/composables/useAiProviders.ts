// ───────────────────────────────────────────────────────────────────────────
// AI provider profiles — module-level singleton shared by the Settings tab's
// provider editor and the Story activity's AI generators (character refine /
// scene generation). Profiles persist to `.dotzuki-editor.providers.json` via the
// `/api/ai/providers` endpoint; API keys live in localStorage (see useAiStream),
// never on disk here.
// ───────────────────────────────────────────────────────────────────────────
import { ref } from 'vue'
import type { ProviderProfile } from '@/types'

const providers = ref<ProviderProfile[]>([])
let loadedOnce = false

export function useAiProviders() {
  /** Fetch profiles once (idempotent); pass force to refetch. */
  async function loadProviders(force = false): Promise<void> {
    if (loadedOnce && !force) return
    try {
      const resp = await fetch('/api/ai/providers')
      providers.value = resp.ok ? await resp.json() : []
    } catch {
      providers.value = []
    }
    loadedOnce = true
  }

  async function saveProviders(next: ProviderProfile[]): Promise<void> {
    const resp = await fetch('/api/ai/providers', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    })
    if (!resp.ok) throw new Error(await resp.json().then(j => j.error).catch(() => resp.statusText))
    providers.value = next
    loadedOnce = true
  }

  return { providers, loadProviders, saveProviders }
}
