<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAiGenerate } from '@/composables/useAiGenerate'
import { useProposals } from '@/composables/useProposals'
import AiKeyPrompt from '@/activities/StoryActivity/AiKeyPrompt.vue'
import ProposalCard from '@/components/assistant/ProposalCard.vue'

const props = defineProps<{ tableId: string }>()
const emit = defineEmits<{ close: []; applied: [] }>()

const { t } = useI18n()
const ai = useAiGenerate()
const tray = useProposals()

const mode = ref<'generate' | 'batch'>('generate')
const prompt = ref('')
const count = ref(6)
const ranOnce = ref(false)

ai.ensure()

async function run() {
  if (!prompt.value.trim() || ai.busy.value) return
  tray.clear()
  ranOnce.value = true
  const actionId = mode.value === 'generate' ? 'generate-data-set' : 'batch-edit-data'
  const input = mode.value === 'generate'
    ? { tableId: props.tableId, prompt: prompt.value.trim(), count: count.value }
    : { tableId: props.tableId, prompt: prompt.value.trim() }
  try { await ai.run(actionId, input, { onProposal: (d) => tray.add(d) }) } catch { /* surfaced via ai.error */ }
}

async function applyOne(p: any) { await tray.applyProposal(p); emit('applied') }
async function applyAllAndReload() { await tray.applyAll(); emit('applied') }
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60" @click.self="emit('close')">
    <div class="w-[40rem] max-h-[85vh] bg-surface-deep border border-border rounded-card shadow-popover flex flex-col">
      <div class="flex items-center gap-2 px-4 py-2.5 border-b border-border">
        <span class="text-sm font-bold text-accent-ink">✨ {{ t('data.aiTitle') }}</span>
        <div class="ml-2 flex rounded-control overflow-hidden border border-border text-tiny">
          <button class="px-2 py-0.5" :class="mode === 'generate' ? 'bg-accent text-white' : 'bg-surface text-ink-muted'" @click="mode = 'generate'">{{ t('data.generateSet') }}</button>
          <button class="px-2 py-0.5" :class="mode === 'batch' ? 'bg-accent text-white' : 'bg-surface text-ink-muted'" @click="mode = 'batch'">{{ t('data.batchEdit') }}</button>
        </div>
        <select v-if="ai.providers.value.length" v-model="ai.providerId.value"
          class="ml-auto bg-raised text-ink-secondary text-tiny rounded-control px-1.5 py-0.5 border border-border-strong max-w-[7rem]">
          <option v-for="p in ai.providers.value" :key="p.id" :value="p.id">{{ p.id }}</option>
        </select>
        <button @click="emit('close')" class="text-ink-faint hover:text-ink-body text-sm">✕</button>
      </div>

      <div class="p-3 space-y-2 border-b border-border">
        <textarea v-model="prompt" rows="2"
          :placeholder="mode === 'generate' ? t('data.generatePlaceholder') : t('data.batchPlaceholder')"
          class="w-full resize-none bg-inset border border-border rounded-control px-2 py-1.5 text-xs text-ink focus:outline-none focus:border-accent-strong"></textarea>
        <div class="flex items-center gap-2">
          <template v-if="mode === 'generate'">
            <span class="text-tiny text-ink-faint">{{ t('data.count') }}</span>
            <input v-model.number="count" type="number" min="1" max="20"
              class="w-14 bg-inset border border-border rounded-control px-1.5 py-0.5 text-xs text-ink" />
          </template>
          <button :disabled="ai.busy.value || !prompt.trim()" @click="run"
            class="ml-auto px-3 py-1 text-xs rounded-control bg-accent text-white hover:bg-accent-strong disabled:opacity-40">
            {{ ai.busy.value ? t('data.generating') : (mode === 'generate' ? t('data.generateSet') : t('data.batchEdit')) }}</button>
        </div>
        <p v-if="ai.error.value" class="text-tiny text-danger-ink">{{ ai.error.value === 'no-provider' ? t('data.noProvider') : ai.error.value }}</p>
      </div>

      <div class="flex-1 overflow-y-auto p-3 space-y-2">
        <div v-if="tray.proposals.value.length" class="flex items-center gap-2">
          <span class="text-tiny font-semibold text-ink-muted">{{ t('data.proposals') }} ({{ tray.proposals.value.length }})</span>
          <button v-if="tray.proposals.value.some(p => p.status === 'pending')" @click="applyAllAndReload"
            class="ml-auto text-micro px-2 py-0.5 rounded-control bg-success-hover text-white hover:bg-success">{{ t('data.applyAll') }}</button>
        </div>
        <ProposalCard v-for="p in tray.proposals.value" :key="p.uid" :proposal="p"
          @apply="applyOne(p)" @discard="tray.discard(p)" @revert="tray.revertProposal(p)" />
        <p v-if="ai.busy.value" class="text-xs text-ink-faint italic">{{ t('data.generating') }}</p>
        <p v-else-if="ranOnce && !tray.proposals.value.length && !ai.error.value" class="text-xs text-ink-faint">{{ t('data.noProposals') }}</p>
      </div>

      <AiKeyPrompt v-if="ai.showKeyPrompt.value" :provider-id="ai.providerId.value"
        @submit="ai.onKeySubmit" @cancel="ai.onKeyCancel" />
    </div>
  </div>
</template>
