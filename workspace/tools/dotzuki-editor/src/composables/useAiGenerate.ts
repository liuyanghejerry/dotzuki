// ───────────────────────────────────────────────────────────────────────────
// useAiGenerate — shared client orchestration for the per-activity "generate"
// panels (GUI / Data / Script). Handles provider selection + the API-key prompt
// and streams a registry action via /api/ai/run, dispatching the standard event
// vocab to caller-supplied handlers. The done `result` is returned.
// ───────────────────────────────────────────────────────────────────────────
import { ref } from 'vue'
import { useAiProviders } from './useAiProviders'
import { useAiUsage } from './useAiUsage'
import { getStoredKey, setStoredKey, streamSse } from './useAiStream'
import type { ProviderProfile } from '@/types'

export interface AiGenHandlers {
  onText?: (delta: string) => void
  onTool?: (name: string) => void
  onProposal?: (data: any) => void
}

export function useAiGenerate() {
  const { providers, loadProviders } = useAiProviders()
  const providerId = ref('')
  const busy = ref(false)
  const error = ref('')
  const showKeyPrompt = ref(false)
  let pending: ((p: ProviderProfile, k: string) => void) | null = null

  async function ensure() { await loadProviders(); if (!providerId.value) providerId.value = providers.value[0]?.id ?? '' }
  function provider(): ProviderProfile | undefined { return providers.value.find(p => p.id === providerId.value) || providers.value[0] }

  function run(actionId: string, input: any, handlers: AiGenHandlers = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      error.value = ''
      const p = provider()
      if (!p) { error.value = 'no-provider'; reject(new Error('no-provider')); return }
      const go = (prov: ProviderProfile, k: string) => doRun(actionId, input, handlers, prov, k).then(resolve, reject)
      const key = getStoredKey(p.id)
      if (!key) { pending = go; showKeyPrompt.value = true; return }
      go(p, key)
    })
  }

  function onKeySubmit(key: string, remember: boolean) {
    showKeyPrompt.value = false
    const p = provider()
    if (!p || !pending) return
    if (remember) setStoredKey(p.id, key)
    const go = pending; pending = null; go(p, key)
  }
  function onKeyCancel() { showKeyPrompt.value = false; pending = null }

  async function doRun(actionId: string, input: any, handlers: AiGenHandlers, prov: ProviderProfile, key: string): Promise<any> {
    busy.value = true
    let result: any = null
    try {
      await streamSse('/api/ai/run', { actionId, input, profile: prov, apiKey: key }, (ev, data) => {
        if (ev === 'text') handlers.onText?.(data?.delta || '')
        else if (ev === 'tool-call') handlers.onTool?.(data?.name || '')
        else if (ev === 'proposal') handlers.onProposal?.(data)
        else if (ev === 'partial') result = data?.object
        else if (ev === 'usage') useAiUsage().record(data)
        else if (ev === 'done') result = data?.result
        else if (ev === 'error') error.value = data?.message || 'AI error'
      })
    } finally { busy.value = false }
    if (error.value) throw new Error(error.value)
    return result
  }

  return { providers, providerId, busy, error, showKeyPrompt, ensure, run, onKeySubmit, onKeyCancel }
}
