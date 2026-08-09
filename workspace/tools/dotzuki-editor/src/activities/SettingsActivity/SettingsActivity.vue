<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAiProviders } from '@/composables/useAiProviders'
import { useEditorSettings } from '@/composables/useEditorSettings'
import ProviderSettings from './ProviderSettings.vue'
import ImageProviderSettings from './ImageProviderSettings.vue'

const { t } = useI18n()
const providers = useAiProviders()
const es = useEditorSettings()

const w = ref(160)
const h = ref(144)
const savedMsg = ref('')
const saving = ref(false)
const providerTab = ref<'text' | 'image'>('text')
// AI assistant behavior switches (seeded from the loaded settings on mount).
const includeUserSkills = ref(true)
const allowCodeExecution = ref(false)
const assistantSavedMsg = ref('')

onMounted(async () => {
  providers.loadProviders()
  await es.load()
  // Seed the form from the effective resolution (saved override → map default → GB).
  const s = es.screen.value
  w.value = s.width
  h.value = s.height
  includeUserSkills.value = es.assistant.value.includeUserSkills
  allowCodeExecution.value = es.assistant.value.allowCodeExecution
})

async function saveScreen() {
  if (!(w.value > 0 && h.value > 0)) return
  saving.value = true
  try {
    es.settings.value = { ...es.settings.value, screen: { width: Math.round(w.value), height: Math.round(h.value) } }
    await es.save()
    savedMsg.value = t('settings.saved')
    setTimeout(() => { savedMsg.value = '' }, 1500)
  } finally {
    saving.value = false
  }
}

/** Drop the override and fall back to the project/Game-Boy default. */
async function resetScreen() {
  saving.value = true
  try {
    const { screen: _drop, ...rest } = es.settings.value
    es.settings.value = rest
    await es.save()
    const s = es.defaultScreen.value
    w.value = s.width
    h.value = s.height
    savedMsg.value = t('settings.saved')
    setTimeout(() => { savedMsg.value = '' }, 1500)
  } finally {
    saving.value = false
  }
}

/** Persist the AI assistant behavior switches (applied on the next chat turn). */
async function saveAssistant() {
  saving.value = true
  try {
    es.settings.value = {
      ...es.settings.value,
      assistant: { includeUserSkills: includeUserSkills.value, allowCodeExecution: allowCodeExecution.value },
    }
    await es.save()
    assistantSavedMsg.value = t('settings.saved')
    setTimeout(() => { assistantSavedMsg.value = '' }, 1500)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="h-full overflow-y-auto">
    <!-- Screen / camera resolution -->
    <section class="p-5 max-w-2xl border-b border-gray-800">
      <h2 class="text-base font-bold text-blue-400 mb-1">{{ t('settings.screen.title') }}</h2>
      <p class="text-[11px] text-gray-400 mb-4 leading-snug">{{ t('settings.screen.desc') }}</p>
      <div class="flex items-end gap-3 flex-wrap">
        <label class="text-[11px] text-gray-400">{{ t('settings.screen.width') }}
          <input v-model.number="w" type="number" min="1" class="mt-1 block w-28 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-100" />
        </label>
        <span class="text-gray-600 pb-1.5">×</span>
        <label class="text-[11px] text-gray-400">{{ t('settings.screen.height') }}
          <input v-model.number="h" type="number" min="1" class="mt-1 block w-28 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-100" />
        </label>
        <button
          @click="saveScreen"
          :disabled="saving || !(w > 0 && h > 0)"
          class="px-3 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40"
        >{{ t('settings.save') }}</button>
        <button
          @click="resetScreen"
          :disabled="saving"
          class="px-3 py-1 text-xs rounded text-gray-400 hover:text-gray-200"
        >{{ t('settings.screen.useDefault') }}</button>
        <span v-if="savedMsg" class="text-[11px] text-green-400 pb-1.5">{{ savedMsg }}</span>
      </div>
      <p class="text-[10px] text-gray-600 mt-2 leading-snug">{{ t('settings.screen.hint') }}</p>
    </section>

    <!-- AI assistant behavior -->
    <section class="p-5 max-w-2xl border-b border-gray-800">
      <h2 class="text-base font-bold text-blue-400 mb-1">{{ t('settings.assistant.title') }}</h2>
      <p class="text-[11px] text-gray-400 mb-4 leading-snug">{{ t('settings.assistant.desc') }}</p>
      <div class="flex flex-col gap-3">
        <label class="flex items-start gap-2 cursor-pointer">
          <input v-model="includeUserSkills" type="checkbox" class="mt-0.5 accent-blue-500" />
          <span>
            <span class="block text-xs text-gray-200">{{ t('settings.assistant.includeUserSkills') }}</span>
            <span class="block text-[10px] text-gray-500 leading-snug">{{ t('settings.assistant.includeUserSkillsHint') }}</span>
          </span>
        </label>
        <label class="flex items-start gap-2 cursor-pointer">
          <input v-model="allowCodeExecution" type="checkbox" class="mt-0.5 accent-red-500" />
          <span>
            <span class="block text-xs text-gray-200">{{ t('settings.assistant.allowCodeExecution') }}</span>
            <span class="block text-[10px] text-gray-500 leading-snug">{{ t('settings.assistant.allowCodeExecutionHint') }}</span>
          </span>
        </label>
        <div class="flex items-center gap-3">
          <button
            @click="saveAssistant"
            :disabled="saving"
            class="px-3 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40"
          >{{ t('settings.save') }}</button>
          <span v-if="assistantSavedMsg" class="text-[11px] text-green-400">{{ assistantSavedMsg }}</span>
        </div>
      </div>
    </section>

    <!-- AI providers — tabbed (text | image) to save vertical space -->
    <div class="px-5 pt-4 max-w-2xl">
      <div class="flex gap-1 border-b border-gray-800">
        <button
          @click="providerTab = 'text'"
          class="px-3 py-1.5 text-xs rounded-t border border-b-0"
          :class="providerTab === 'text' ? 'bg-gray-800 text-blue-300 border-gray-700' : 'border-transparent text-gray-500 hover:text-gray-300'"
        >{{ t('settings.providerTab.text') }}</button>
        <button
          @click="providerTab = 'image'"
          class="px-3 py-1.5 text-xs rounded-t border border-b-0"
          :class="providerTab === 'image' ? 'bg-gray-800 text-purple-300 border-gray-700' : 'border-transparent text-gray-500 hover:text-gray-300'"
        >{{ t('settings.providerTab.image') }}</button>
      </div>
    </div>
    <ProviderSettings v-show="providerTab === 'text'" />
    <ImageProviderSettings v-show="providerTab === 'image'" />
  </div>
</template>
