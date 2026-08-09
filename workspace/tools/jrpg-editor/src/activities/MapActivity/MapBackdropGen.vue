<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAiImageProviders } from '@/composables/useAiImageProviders'
import { getStoredKey, setStoredKey } from '@/composables/useAiStream'
import AiKeyPrompt from '@/activities/StoryActivity/AiKeyPrompt.vue'
import type { ImageProviderProfile } from '@/types'

const props = defineProps<{ mapName: string }>()
const emit = defineEmits<{ close: []; done: [] }>()

const { t } = useI18n()
const { imageProviders, loadImageProviders } = useAiImageProviders()
const providerId = ref('')
const prompt = ref('')
const busy = ref(false)
const error = ref('')
const showKeyPrompt = ref(false)

onMounted(async () => { await loadImageProviders(); providerId.value = imageProviders.value[0]?.id ?? '' })

function provider(): ImageProviderProfile | undefined {
  return imageProviders.value.find(p => p.id === providerId.value) || imageProviders.value[0]
}

function generate() {
  if (!prompt.value.trim() || busy.value) return
  const p = provider()
  if (!p) { error.value = 'no-provider'; return }
  const key = getStoredKey(p.id)
  if (!key) { showKeyPrompt.value = true; return }
  run(p, key)
}

function onKeySubmit(key: string, remember: boolean) {
  showKeyPrompt.value = false
  const p = provider(); if (!p) return
  if (remember) setStoredKey(p.id, key)
  run(p, key)
}

async function run(p: ImageProviderProfile, key: string) {
  busy.value = true; error.value = ''
  try {
    const resp = await fetch('/api/maps/generate-backdrop', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mapName: props.mapName, prompt: prompt.value.trim(), profile: p, apiKey: key }),
    })
    const data = await resp.json()
    if (!resp.ok || !data.ok) throw new Error(data.error || 'generation failed')
    emit('done'); emit('close')
  } catch (e: any) { error.value = e?.message || 'generation failed' }
  finally { busy.value = false }
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60" @click.self="emit('close')">
    <div class="w-96 bg-gray-850 border border-gray-700 rounded-lg shadow-xl p-4">
      <div class="flex items-center gap-2 mb-2">
        <span class="text-sm font-bold text-blue-400">✨ {{ t('map.backdropTitle') }}</span>
        <span class="text-[11px] text-gray-500 truncate">{{ mapName }}</span>
        <select v-if="imageProviders.length" v-model="providerId"
          class="ml-auto bg-gray-700 text-gray-200 text-[11px] rounded px-1.5 py-0.5 border border-gray-600 max-w-[7rem]">
          <option v-for="p in imageProviders" :key="p.id" :value="p.id">{{ p.id }}</option>
        </select>
      </div>
      <p v-if="!imageProviders.length" class="text-[11px] text-amber-400 mb-2">{{ t('map.noImageProvider') }}</p>
      <textarea v-model="prompt" rows="3" :placeholder="t('map.backdropPlaceholder')"
        class="w-full resize-none bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-100 focus:outline-none focus:border-blue-500"></textarea>
      <p v-if="error" class="text-[11px] text-red-400 mt-1">{{ error === 'no-provider' ? t('map.noImageProvider') : error }}</p>
      <div class="flex justify-end gap-2 mt-3">
        <button @click="emit('close')" class="px-3 py-1 text-xs rounded text-gray-400 hover:text-gray-200">{{ t('common.cancel') }}</button>
        <button :disabled="busy || !prompt.trim() || !imageProviders.length" @click="generate"
          class="px-3 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40">
          {{ busy ? t('map.generating') : t('map.generate') }}</button>
      </div>
      <AiKeyPrompt v-if="showKeyPrompt" :provider-id="providerId" @submit="onKeySubmit" @cancel="showKeyPrompt = false" />
    </div>
  </div>
</template>
