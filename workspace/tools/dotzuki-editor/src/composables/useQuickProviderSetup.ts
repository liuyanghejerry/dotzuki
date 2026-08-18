// ───────────────────────────────────────────────────────────────────────────
// Quick provider setup — inline form used on the welcome screen and the
// AssistantPanel (welcome mode) for first-time AI provider configuration.
// Extracted so both surfaces share the same vendor-preset + save logic.
// ───────────────────────────────────────────────────────────────────────────
import { ref, computed } from 'vue'
import { useAiProviders } from './useAiProviders'
import { setStoredKey } from './useAiStream'
import { PROVIDER_PRESETS, DEFAULT_PRESET_ID, presetById } from '@/components/assistant/providerPresets'
import type { ProviderProfile } from '@/types'

export interface QuickProviderForm {
  id: string
  baseURL: string
  model: string
  key: string
}

function blankForm(): QuickProviderForm {
  const preset = presetById(DEFAULT_PRESET_ID)
  return { id: preset.id, baseURL: preset.baseURL, model: '', key: '' }
}

export function useQuickProviderSetup() {
  const { providers, saveProviders } = useAiProviders()

  const qpVendor = ref(DEFAULT_PRESET_ID)
  const qpPreset = computed(() => presetById(qpVendor.value))
  const qp = ref<QuickProviderForm>(blankForm())
  const qpSaving = ref(false)
  const qpError = ref('')

  const qpReady = computed(() => {
    const v = qp.value
    if (!v.id.trim() || !v.model.trim() || !v.key.trim()) return false
    // openai-compatible endpoints need a base URL; anthropic uses the SDK
    // default. The dsh backend ignores baseURL entirely (local runtime).
    if (qpPreset.value.backend === 'dsh') return true
    return qpPreset.value.kind !== 'openai' || !!v.baseURL.trim()
  })

  /** Vendor switch: overwrite id/baseURL from the preset; model/key stay as typed. */
  function onVendorChange() {
    const p = qpPreset.value
    qp.value.id = p.id === 'custom' ? '' : p.id
    qp.value.baseURL = p.baseURL
  }

  /**
   * Save the current quick-setup form as a new provider profile + API key.
   * Returns the saved profile id on success, or `null` on failure (sets `qpError`).
   * The caller can use the returned id to select the profile immediately.
   */
  async function saveQuickProvider(): Promise<string | null> {
    if (!qpReady.value || qpSaving.value) return null
    qpSaving.value = true
    qpError.value = ''
    try {
      const profile: ProviderProfile = {
        id: qp.value.id.trim(), kind: qpPreset.value.kind,
        baseURL: qp.value.baseURL.trim(), model: qp.value.model.trim(),
        // The execution backend rides along from the preset (absent = 'sdk').
        ...(qpPreset.value.backend === 'dsh' ? { backend: 'dsh' as const } : {}),
      }
      await saveProviders([...providers.value, profile])
      setStoredKey(profile.id, qp.value.key.trim())
      const savedId = profile.id
      qp.value = blankForm()
      return savedId
    } catch (e: any) {
      qpError.value = e?.message || 'save failed'
      return null
    } finally {
      qpSaving.value = false
    }
  }

  function resetQp() {
    qpVendor.value = DEFAULT_PRESET_ID
    qp.value = blankForm()
    qpSaving.value = false
    qpError.value = ''
  }

  return {
    // state
    qpVendor, qpPreset, qp, qpSaving, qpError, qpReady,
    // actions
    onVendorChange, saveQuickProvider, resetQp,
  }
}
