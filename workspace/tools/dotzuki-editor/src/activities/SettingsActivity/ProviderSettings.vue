<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAiProviders } from '@/composables/useAiProviders'
import { getStoredKey, setStoredKey } from '@/composables/useAiStream'
import type { ProviderProfile } from '@/types'

const { t } = useI18n()
const ai = useAiProviders()
const { providers } = ai

interface Draft extends ProviderProfile {
  apiKey: string
}

function blankDraft(): Draft {
  return { id: '', kind: 'openai', baseURL: '', model: '', embeddingModel: '', proxyUrl: '', apiKey: '' }
}

const draft = reactive<Draft>(blankDraft())
const editingIndex = ref<number | null>(null)
const savedMsg = ref('')

const testPrompt = ref(t('story.providers.testPromptDefault'))
const testing = ref(false)
const testResult = ref<{ ok: boolean; msg: string } | null>(null)
const rowTest = reactive<{ index: number | null; testing: boolean; result: { ok: boolean; msg: string } | null }>({
  index: null, testing: false, result: null,
})

function keyStored(id: string): boolean {
  return !!getStoredKey(id)
}

/** Whether the profile being edited already has a key saved under its id. */
const editingHasKey = computed(() => editingIndex.value !== null && keyStored(draft.id.trim()))

function edit(i: number) {
  editingIndex.value = i
  Object.assign(draft, blankDraft(), JSON.parse(JSON.stringify(providers.value[i])))
  draft.apiKey = ''
  testResult.value = null
}

function reset() {
  editingIndex.value = null
  Object.assign(draft, blankDraft())
  testResult.value = null
}

function toProfile(): ProviderProfile {
  const clean: ProviderProfile = { id: draft.id.trim(), kind: draft.kind, baseURL: draft.baseURL.trim(), model: draft.model.trim() }
  if (draft.embeddingModel?.trim()) clean.embeddingModel = draft.embeddingModel.trim()
  if (draft.proxyUrl?.trim()) clean.proxyUrl = draft.proxyUrl.trim()
  return clean
}

async function commit() {
  if (!draft.id.trim()) return
  const clean = toProfile()
  const next = providers.value.slice()
  if (editingIndex.value !== null) next[editingIndex.value] = clean
  else {
    const existing = next.findIndex(p => p.id === clean.id)
    if (existing >= 0) next[existing] = clean
    else next.push(clean)
  }
  await ai.saveProviders(next)
  // Persist a freshly-typed key under the (possibly new) id.
  if (draft.apiKey.trim()) setStoredKey(clean.id, draft.apiKey.trim())
  reset()
  flash(t('story.providers.saved'))
}

async function removeAt(i: number) {
  const id = providers.value[i].id
  const next = providers.value.slice()
  next.splice(i, 1)
  await ai.saveProviders(next)
  localStorage.removeItem('jrpg-ai-key-' + id)
  if (editingIndex.value === i) reset()
}

function clearKey(id: string) {
  localStorage.removeItem('jrpg-ai-key-' + id)
  flash(t('story.providers.keyCleared'))
}

function flash(m: string) {
  savedMsg.value = m
  setTimeout(() => { if (savedMsg.value === m) savedMsg.value = '' }, 1500)
}

async function callTest(profile: ProviderProfile, apiKey: string): Promise<{ ok: boolean; msg: string }> {
  try {
    const resp = await fetch('/api/ai/test-provider', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile, apiKey, prompt: testPrompt.value }),
    })
    const data = await resp.json()
    if (!resp.ok) throw new Error(data.error || resp.statusText)
    return data.ok ? { ok: true, msg: data.text || '' } : { ok: false, msg: data.error || '' }
  } catch (e) {
    return { ok: false, msg: e instanceof Error ? e.message : String(e) }
  }
}

/** Test the draft in the editor, using the typed key (or a saved one when blank). */
async function runTest() {
  testResult.value = null
  if (!draft.id.trim() || !draft.model.trim()) {
    testResult.value = { ok: false, msg: t('story.providers.testNeedsModel') }
    return
  }
  const key = draft.apiKey.trim() || getStoredKey(draft.id.trim()) || ''
  if (!key) {
    testResult.value = { ok: false, msg: t('story.providers.testNeedsKey') }
    return
  }
  testing.value = true
  testResult.value = await callTest(toProfile(), key)
  testing.value = false
}

/** Test a saved profile from its row, using its stored key. */
async function runRowTest(i: number) {
  const profile = providers.value[i]
  const key = getStoredKey(profile.id) || ''
  rowTest.index = i
  rowTest.result = null
  if (!key) {
    rowTest.result = { ok: false, msg: t('story.providers.testNeedsKey') }
    return
  }
  rowTest.testing = true
  rowTest.result = await callTest(profile, key)
  rowTest.testing = false
}

function applyPreset(kind: 'anthropic' | 'openai' | 'deepseek' | 'ollama') {
  if (kind === 'anthropic') Object.assign(draft, { id: draft.id || 'claude', kind: 'anthropic', baseURL: 'https://api.anthropic.com', model: 'claude-opus-4-8' })
  if (kind === 'openai') Object.assign(draft, { id: draft.id || 'openai', kind: 'openai', baseURL: 'https://api.openai.com/v1', model: 'gpt-4o' })
  if (kind === 'deepseek') Object.assign(draft, { id: draft.id || 'deepseek', kind: 'openai', baseURL: 'https://api.deepseek.com', model: 'deepseek-chat' })
  if (kind === 'ollama') Object.assign(draft, { id: draft.id || 'local', kind: 'openai', baseURL: 'http://localhost:11434/v1', model: 'qwen2.5-coder' })
}
</script>

<template>
  <div class="p-5 max-w-2xl">
    <h2 class="text-base font-bold text-accent-ink mb-1">{{ t('story.providers.title') }}</h2>
    <p class="text-tiny text-ink-muted mb-4 leading-snug">{{ t('story.providers.desc') }}</p>

    <!-- Existing profiles -->
    <div class="space-y-2 mb-6">
      <div
        v-for="(p, i) in providers"
        :key="p.id"
        class="bg-surface border border-border rounded-control px-3 py-2"
      >
        <div class="flex items-center gap-3">
          <div class="flex-1 min-w-0">
            <div class="text-sm text-ink font-medium">{{ p.id }}
              <span class="text-micro text-ink-faint ml-1">{{ p.kind }}</span>
            </div>
            <div class="text-tiny text-ink-faint truncate">{{ p.model }} · {{ p.baseURL }}</div>
          </div>
          <span
            class="text-micro px-1.5 py-0.5 rounded-control"
            :class="keyStored(p.id) ? 'bg-success-surface/40 text-success-ink' : 'bg-raised text-ink-muted'"
          >{{ keyStored(p.id) ? t('story.providers.keyStored') : t('story.providers.noKey') }}</span>
          <button @click="runRowTest(i)" :disabled="rowTest.testing" class="text-tiny text-ink-muted hover:text-success-ink disabled:opacity-40">
            {{ rowTest.index === i && rowTest.testing ? t('story.providers.testing') : t('story.providers.test') }}
          </button>
          <button v-if="keyStored(p.id)" @click="clearKey(p.id)" class="text-tiny text-ink-muted hover:text-warning-ink">{{ t('story.providers.clearKey') }}</button>
          <button @click="edit(i)" class="text-tiny text-ink-muted hover:text-accent-ink">{{ t('story.providers.edit') }}</button>
          <button @click="removeAt(i)" class="text-tiny text-ink-muted hover:text-danger-ink">{{ t('story.providers.delete') }}</button>
        </div>
        <!-- Row test result -->
        <div
          v-if="rowTest.index === i && rowTest.result"
          class="mt-2 text-tiny rounded-control px-2 py-1 whitespace-pre-wrap break-words"
          :class="rowTest.result.ok ? 'bg-success-surface text-success-ink-strong' : 'bg-danger-surface text-danger-ink-strong'"
        >
          <span class="font-semibold">{{ rowTest.result.ok ? t('story.providers.testOk') : t('story.providers.testFailed') }}</span>
          <span v-if="rowTest.result.msg"> · {{ rowTest.result.msg }}</span>
        </div>
      </div>
      <p v-if="!providers.length" class="text-xs text-ink-disabled">{{ t('story.providers.empty') }}</p>
    </div>

    <!-- Editor -->
    <div class="bg-surface-deep border border-border rounded-control p-4 space-y-3">
      <div class="flex items-center justify-between">
        <h3 class="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          {{ editingIndex !== null ? t('story.providers.editProfile') : t('story.providers.newProfile') }}
        </h3>
        <div class="flex gap-1">
          <button @click="applyPreset('anthropic')" class="text-micro px-1.5 py-0.5 rounded-control bg-raised hover:bg-overlay">Claude</button>
          <button @click="applyPreset('openai')" class="text-micro px-1.5 py-0.5 rounded-control bg-raised hover:bg-overlay">OpenAI</button>
          <button @click="applyPreset('deepseek')" class="text-micro px-1.5 py-0.5 rounded-control bg-raised hover:bg-overlay">DeepSeek</button>
          <button @click="applyPreset('ollama')" class="text-micro px-1.5 py-0.5 rounded-control bg-raised hover:bg-overlay">Ollama</button>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <label class="text-tiny text-ink-muted">{{ t('story.providers.name') }}
          <input v-model="draft.id" class="mt-1 w-full bg-surface border border-border rounded-control px-2 py-1 text-sm text-ink" />
        </label>
        <label class="text-tiny text-ink-muted">{{ t('story.providers.protocol') }}
          <select v-model="draft.kind" class="mt-1 w-full bg-surface border border-border rounded-control px-2 py-1 text-sm text-ink">
            <option value="anthropic">{{ t('story.providers.protocolAnthropic') }}</option>
            <option value="openai">{{ t('story.providers.protocolOpenai') }}</option>
          </select>
        </label>
        <label class="text-tiny text-ink-muted col-span-2">{{ t('story.providers.baseURL') }}
          <input v-model="draft.baseURL" placeholder="https://api.deepseek.com" class="mt-1 w-full bg-surface border border-border rounded-control px-2 py-1 text-sm text-ink" />
        </label>
        <label class="text-tiny text-ink-muted col-span-2">{{ t('story.providers.proxy') }}
          <input v-model="draft.proxyUrl" :placeholder="t('story.providers.proxyPlaceholder')" class="mt-1 w-full bg-surface border border-border rounded-control px-2 py-1 text-sm text-ink" />
          <span class="text-micro text-ink-faint block mt-0.5">{{ t('story.providers.proxyHint') }}</span>
        </label>
        <label class="text-tiny text-ink-muted col-span-2">{{ t('story.providers.modelText') }}
          <input v-model="draft.model" placeholder="deepseek-chat" class="mt-1 w-full bg-surface border border-border rounded-control px-2 py-1 text-sm text-ink" />
        </label>
        <label v-if="draft.kind === 'openai'" class="text-tiny text-ink-muted col-span-2">{{ t('story.providers.embeddingModel') }}
          <input v-model="draft.embeddingModel" placeholder="text-embedding-3-small" class="mt-1 w-full bg-surface border border-border rounded-control px-2 py-1 text-sm text-ink" />
          <span class="text-micro text-ink-faint block mt-0.5">{{ t('story.providers.embeddingHint') }}</span>
        </label>
        <label class="text-tiny text-ink-muted col-span-2">{{ t('story.providers.apiKey') }}
          <input
            v-model="draft.apiKey"
            type="password"
            autocomplete="off"
            :placeholder="t('story.providers.apiKeyPlaceholder')"
            class="mt-1 w-full bg-surface border border-border rounded-control px-2 py-1 text-sm text-ink"
          />
          <span v-if="editingHasKey" class="text-micro text-ink-faint">{{ t('story.providers.apiKeyKept') }}</span>
        </label>
      </div>

      <!-- Test connection -->
      <div class="border-t border-border/70 pt-3 space-y-2">
        <label class="text-tiny text-ink-muted block">{{ t('story.providers.testPrompt') }}
          <input v-model="testPrompt" class="mt-1 w-full bg-surface border border-border rounded-control px-2 py-1 text-sm text-ink" />
        </label>
        <div class="flex items-center gap-2">
          <button
            @click="runTest"
            :disabled="testing || !draft.id.trim()"
            class="px-3 py-1 text-xs rounded-control bg-success-hover text-white hover:bg-success disabled:opacity-40"
          >
            {{ testing ? t('story.providers.testing') : t('story.providers.runTest') }}
          </button>
        </div>
        <div
          v-if="testResult"
          class="text-tiny rounded-control px-2 py-1.5 whitespace-pre-wrap break-words"
          :class="testResult.ok ? 'bg-success-surface text-success-ink-strong' : 'bg-danger-surface text-danger-ink-strong'"
        >
          <span class="font-semibold">{{ testResult.ok ? t('story.providers.testOk') : t('story.providers.testFailed') }}</span>
          <span v-if="testResult.msg"> · {{ testResult.msg }}</span>
        </div>
      </div>

      <div class="flex items-center gap-2 border-t border-border/70 pt-3">
        <button @click="commit" :disabled="!draft.id.trim()" class="px-3 py-1 text-xs rounded-control bg-accent text-white hover:bg-accent-strong disabled:opacity-40">
          {{ editingIndex !== null ? t('story.providers.update') : t('story.providers.add') }}
        </button>
        <button v-if="editingIndex !== null" @click="reset" class="px-3 py-1 text-xs rounded-control text-ink-muted hover:text-ink-secondary">{{ t('story.providers.cancel') }}</button>
        <span v-if="savedMsg" class="text-tiny text-success-ink">{{ savedMsg }}</span>
      </div>
    </div>
  </div>
</template>
