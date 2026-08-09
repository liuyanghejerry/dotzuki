<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStoryActivity } from '@/composables/useStoryActivity'
import { useActivityNav } from '@/composables/useActivityNav'
import { getStoredKey, setStoredKey, streamSse } from '@/composables/useAiStream'
import AiKeyPrompt from './AiKeyPrompt.vue'
import type { ProviderProfile } from '@/types'

const { t } = useI18n()
const story = useStoryActivity()
const nav = useActivityNav()
const { selectedRecord, providers } = story

const quest = selectedRecord.value
const sceneName = ref(quest?.implementedBy?.[0]?.scene || quest?.maps?.[0] || quest?.id || '')
const storyline = ref(quest?.implementedBy?.[0]?.storyline || quest?.id || '')
const providerId = ref(providers.value[0]?.id ?? '')

const open = ref(false)
const busy = ref(false)
const error = ref('')
const log = ref<{ kind: string; text: string }[]>([])
const content = ref('')
const targetPath = ref('')
const validation = ref<{ ok: boolean; output: string } | null>(null)
const backup = ref<string | null>(null)
const applied = ref(false)
const showKeyPrompt = ref(false)

function pushLog(kind: string, text: string) {
  const last = log.value[log.value.length - 1]
  if (last && last.kind === kind && (kind === 'text' || kind === 'reasoning')) last.text += text
  else log.value.push({ kind, text })
}

function generate(previousError?: string) {
  error.value = ''
  const provider = providers.value.find(p => p.id === providerId.value)
  if (!provider) { error.value = t('story.ai.noProvider'); return }
  const key = getStoredKey(provider.id)
  if (!key) { showKeyPrompt.value = true; return }
  runGenerate(provider, key, previousError)
}

function onKeySubmit(key: string, remember: boolean) {
  showKeyPrompt.value = false
  const provider = providers.value.find(p => p.id === providerId.value)
  if (!provider) return
  if (remember) setStoredKey(provider.id, key)
  runGenerate(provider, key)
}

async function runGenerate(provider: ProviderProfile, key: string, previousError?: string) {
  if (!quest?.id) { error.value = t('story.scene.saveFirst'); return }
  busy.value = true
  error.value = ''
  log.value = []
  content.value = ''
  validation.value = null
  applied.value = false
  try {
    await streamSse(
      '/api/ai/generate-scene',
      { questId: quest.id, profile: provider, apiKey: key, sceneName: sceneName.value, storyline: storyline.value, previousError },
      (ev, data) => {
        if (ev === 'text') pushLog('text', data.text || '')
        else if (ev === 'reasoning') pushLog('reasoning', data.text || '')
        else if (ev === 'tool') pushLog('tool', `↳ ${data.name}${data.path ? ' ' + data.path : ''}`)
        else if (ev === 'error') error.value = data.message || 'AI error'
        else if (ev === 'done') {
          content.value = data.content || ''
          targetPath.value = data.targetRel || ''
          if (data.scene) sceneName.value = data.scene
          if (data.storyline) storyline.value = data.storyline
        }
      },
    )
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Scene generation failed'
  } finally {
    busy.value = false
  }
}

async function apply() {
  busy.value = true
  error.value = ''
  try {
    const resp = await fetch('/api/ai/apply-scene', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sceneName: sceneName.value, content: content.value }),
    })
    const data = await resp.json()
    if (!resp.ok) throw new Error(data.error || 'apply failed')
    targetPath.value = data.path
    backup.value = data.backup
    validation.value = data.validation
    applied.value = true
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'apply failed'
  } finally {
    busy.value = false
  }
}

async function revert() {
  if (backup.value == null) return
  busy.value = true
  try {
    await fetch('/api/ai/apply-scene', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sceneName: sceneName.value, content: backup.value }),
    })
    applied.value = false
    validation.value = null
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="border border-purple-900/40 bg-purple-950/15 rounded-lg">
    <button @click="open = !open" class="w-full flex items-center gap-2 px-4 py-2.5 text-left">
      <span>🪄</span>
      <h3 class="text-sm font-semibold text-purple-300 flex-1">{{ t('story.scene.title') }}</h3>
      <span class="text-gray-500 text-xs">{{ open ? '▾' : '▸' }}</span>
    </button>

    <div v-if="open" class="px-4 pb-4 space-y-3">
      <p class="text-[11px] text-gray-400">{{ t('story.scene.desc') }}</p>

      <div class="grid grid-cols-3 gap-2">
        <label class="text-[11px] text-gray-500">{{ t('story.scene.scene') }}
          <input v-model="sceneName" class="mt-1 w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100" />
        </label>
        <label class="text-[11px] text-gray-500">{{ t('story.scene.storyline') }}
          <input v-model="storyline" class="mt-1 w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100" />
        </label>
        <label class="text-[11px] text-gray-500">{{ t('story.scene.provider') }}
          <select v-model="providerId" class="mt-1 w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100">
            <option value="">—</option>
            <option v-for="p in providers" :key="p.id" :value="p.id">{{ p.id }}</option>
          </select>
        </label>
      </div>

      <div class="flex items-center gap-2">
        <button @click="generate()" :disabled="busy || !providerId" class="px-3 py-1 text-xs rounded bg-purple-600 text-white hover:bg-purple-500 disabled:opacity-40">
          {{ busy ? t('story.scene.working') : t('story.scene.generate') }}
        </button>
        <button v-if="!providers.length" @click="nav.goToType('settings')" class="text-[11px] text-blue-400 hover:text-blue-300">
          {{ t('story.ai.addProvider') }}
        </button>
      </div>

      <p v-if="error" class="text-xs text-red-400">{{ error }}</p>

      <!-- agent activity log -->
      <div v-if="log.length" class="max-h-40 overflow-y-auto bg-gray-900/60 rounded p-2 text-[11px] font-mono space-y-1">
        <div v-for="(l, i) in log" :key="i" :class="{
          'text-gray-400': l.kind === 'text',
          'text-gray-600 italic': l.kind === 'reasoning',
          'text-purple-400': l.kind === 'tool',
        }">{{ l.text }}</div>
      </div>

      <!-- generated content -->
      <div v-if="content">
        <div class="flex items-center justify-between mb-1">
          <span class="text-[11px] text-gray-500">{{ targetPath || sceneName }}</span>
          <div class="flex gap-2">
            <button v-if="applied && backup !== null" @click="revert" class="text-[11px] text-gray-400 hover:text-amber-400">{{ t('story.scene.revert') }}</button>
            <button @click="apply" :disabled="busy" class="px-3 py-1 text-xs rounded bg-green-700 text-white hover:bg-green-600 disabled:opacity-40">
              {{ applied ? t('story.scene.reapply') : t('story.scene.apply') }}
            </button>
          </div>
        </div>
        <pre class="max-h-72 overflow-auto bg-gray-900 border border-gray-700 rounded p-2 text-[11px] text-gray-200 whitespace-pre-wrap">{{ content }}</pre>
      </div>

      <!-- validation result -->
      <div v-if="validation" class="rounded p-2 text-[11px]" :class="validation.ok ? 'bg-green-900/20 text-green-300' : 'bg-red-900/20 text-red-300'">
        <div class="flex items-center justify-between mb-1">
          <span class="font-semibold">{{ validation.ok ? t('story.scene.valid') : t('story.scene.invalid') }}</span>
          <button v-if="!validation.ok" @click="generate(validation.output)" :disabled="busy" class="text-[11px] underline hover:no-underline">
            {{ t('story.scene.fix') }}
          </button>
        </div>
        <pre v-if="validation.output" class="whitespace-pre-wrap opacity-80 max-h-32 overflow-auto">{{ validation.output }}</pre>
      </div>
      <p v-else-if="applied" class="text-[11px] text-gray-500">{{ t('story.scene.appliedNoValidate') }}</p>
    </div>

    <AiKeyPrompt v-if="showKeyPrompt" :provider-id="providerId" @submit="onKeySubmit" @cancel="showKeyPrompt = false" />
  </div>
</template>
