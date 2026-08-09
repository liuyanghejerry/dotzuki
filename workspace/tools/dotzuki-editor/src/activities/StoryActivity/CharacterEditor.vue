<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStoryActivity } from '@/composables/useStoryActivity'
import { useActivityNav } from '@/composables/useActivityNav'
import { useEditorStore } from '@/stores/editor'
import { useSpriteStudio, frameName } from '@/composables/useSpriteStudio'
import { loadImage } from '@/composables/spriteCanvas'
import LocalizedField from './LocalizedField.vue'
import StringList from './StringList.vue'
import AiKeyPrompt from './AiKeyPrompt.vue'
import { getStoredKey, setStoredKey } from '@/composables/useAiStream'
import type { ProviderProfile } from '@/types'

const { t } = useI18n()
const story = useStoryActivity()
const nav = useActivityNav()
const editorStore = useEditorStore()
const { selectedRecord, locales, providers, saving } = story

const statuses = ['idea', 'drafted', 'scripted', 'done']
const longFields = ['appearance', 'personality', 'backstory', 'motivation', 'speechStyle'] as const

// ── AI refine ─────────────────────────────────────────────────────────────
const providerId = ref(providers.value[0]?.id ?? '')
const aiBusy = ref(false)
const aiError = ref('')
const proposal = ref<any | null>(null)
const showKeyPrompt = ref(false)

const proposalChanges = computed(() => {
  if (!proposal.value || !selectedRecord.value) return []
  const keys = ['role', 'appearance', 'personality', 'backstory', 'motivation', 'speechStyle']
  return keys
    .filter(k => proposal.value[k] != null && proposal.value[k] !== selectedRecord.value[k])
    .map(k => ({ key: k, value: proposal.value[k] }))
})

function refine() {
  aiError.value = ''
  const provider = providers.value.find(p => p.id === providerId.value)
  if (!provider) { aiError.value = t('story.ai.noProvider'); return }
  const key = getStoredKey(provider.id)
  if (!key) { showKeyPrompt.value = true; return }
  runRefine(provider, key)
}

function onKeySubmit(key: string, remember: boolean) {
  showKeyPrompt.value = false
  const provider = providers.value.find(p => p.id === providerId.value)
  if (!provider) return
  if (remember) setStoredKey(provider.id, key)
  runRefine(provider, key)
}

async function runRefine(provider: ProviderProfile, key: string) {
  if (!selectedRecord.value?.id) { aiError.value = t('story.ai.saveFirst'); return }
  aiBusy.value = true
  aiError.value = ''
  proposal.value = null
  try {
    const resp = await fetch('/api/ai/refine-character', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characterId: selectedRecord.value.id, profile: provider, apiKey: key }),
    })
    if (!resp.ok || !resp.body) {
      throw new Error(await resp.json().then(j => j.error).catch(() => `HTTP ${resp.status}`))
    }
    const reader = resp.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const blocks = buf.split('\n\n')
      buf = blocks.pop() || ''
      for (const block of blocks) {
        const ev = block.match(/^event:\s*(.*)$/m)?.[1]?.trim()
        const dataLine = block.match(/^data:\s*(.*)$/m)?.[1]
        if (!dataLine) continue
        const data = JSON.parse(dataLine)
        if (ev === 'error') aiError.value = data.message || 'AI error'
        else proposal.value = data // partial + done both carry the object
      }
    }
  } catch (e) {
    aiError.value = e instanceof Error ? e.message : 'AI request failed'
  } finally {
    aiBusy.value = false
  }
}

function acceptProposal() {
  const p = proposal.value
  if (!p || !selectedRecord.value) return
  for (const k of ['role', 'appearance', 'personality', 'backstory', 'motivation', 'speechStyle']) {
    if (p[k] != null) selectedRecord.value[k] = p[k]
  }
  if (Array.isArray(p.relationships)) selectedRecord.value.relationships = p.relationships
  if (p.spriteSpec) selectedRecord.value.spriteSpec = p.spriteSpec
  proposal.value = null
}

// ── relationship / npc rows ────────────────────────────────────────────────
function addRel() { selectedRecord.value.relationships.push({ to: '', kind: '' }) }
function delRel(i: number) { selectedRecord.value.relationships.splice(i, 1) }
function addNpc() { selectedRecord.value.engine.npcs.push({ map: '', npcId: 0 }) }
function delNpc(i: number) { selectedRecord.value.engine.npcs.splice(i, 1) }

// ── Sprite preview (portrait / head / dex) ──
const studio = useSpriteStudio()
const spritePreviews = ref<{ cat: string; url: string }[]>([])
const spriteLoading = ref(false)

watch(() => selectedRecord.value?.id, async (charId) => {
  spritePreviews.value = []
  if (!charId) return
  spriteLoading.value = true
  const cats = await studio.loadCategories()
  // Show single-frame categories in priority order
  const previewable = ['portrait', 'head', 'dex']
  const results: { cat: string; url: string }[] = []
  for (const c of cats) {
    if (!previewable.includes(c.id)) continue
    try {
      const meta = await studio.loadMeta(c.id, charId)
      if (!meta.sheet.exists) continue
      const url = studio.fileUrl(c.id, charId, frameName(c, 0, 0), Date.now())
      // Verify the image loads
      await loadImage(url)
      results.push({ cat: c.id, url })
    } catch { /* no sprite for this category */ }
  }
  spritePreviews.value = results
  spriteLoading.value = false
}, { immediate: false })

function onSave() { story.save('characters', selectedRecord.value) }
function goToSpriteEditor() {
  if (selectedRecord.value?.id) editorStore.jumpToCharacter(selectedRecord.value.id)
}
function onDelete() {
  if (confirm(t('story.confirmDelete'))) story.remove('characters', selectedRecord.value.id)
}
</script>

<template>
  <div v-if="selectedRecord" class="h-full overflow-y-auto p-5 max-w-3xl">
    <!-- header -->
    <div class="flex items-center gap-3 mb-4">
      <input
        v-model="selectedRecord.id"
        placeholder="character-id"
        class="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-blue-300 font-mono w-48"
      />
      <select v-model="selectedRecord.status" class="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200">
        <option v-for="s in statuses" :key="s" :value="s">{{ t('story.status.' + s) }}</option>
      </select>
      <!-- Sprite preview thumbnails -->
      <div class="flex items-center gap-2 ml-2">
        <div v-if="spriteLoading" class="text-[10px] text-gray-500">…</div>
        <div
          v-for="sp in spritePreviews" :key="sp.cat"
          class="sprite-checker border border-gray-700 rounded overflow-hidden shrink-0"
          :title="sp.cat"
        >
          <img :src="sp.url" class="block" style="image-rendering: pixelated; width: 32px; height: 32px;" alt="" />
        </div>
        <div
          v-if="!spriteLoading && spritePreviews.length === 0"
          class="sprite-checker border border-gray-700 rounded overflow-hidden shrink-0 w-8 h-8 flex items-center justify-center"
          :title="t('story.spriteStudio.noSheet')"
        >
          <span class="text-gray-600 text-[10px]">–</span>
        </div>
      </div>
      <div class="flex-1" />
      <button @click="goToSpriteEditor" class="px-2 py-1 text-xs rounded text-blue-400 hover:text-blue-300"
        :title="t('character.openInStory')">🎨</button>
      <button @click="onDelete" class="px-2 py-1 text-xs rounded text-gray-400 hover:text-red-400">{{ t('story.delete') }}</button>
      <button @click="onSave" :disabled="saving" class="px-4 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40">
        {{ saving ? t('story.saving') : t('story.save') }}
      </button>
    </div>

    <div class="grid grid-cols-2 gap-4 mb-4">
      <LocalizedField :label="t('story.fields.name')" :locales="locales" v-model="selectedRecord.name" />
      <label class="text-[11px] uppercase tracking-wide text-gray-500">{{ t('story.fields.role') }}
        <input v-model="selectedRecord.role" class="mt-1 w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-100" />
      </label>
    </div>

    <div class="mb-4">
      <StringList :label="t('story.fields.tags')" v-model="selectedRecord.tags" :placeholder="t('story.addTag')" />
    </div>

    <div class="space-y-3 mb-5">
      <label v-for="f in longFields" :key="f" class="block text-[11px] uppercase tracking-wide text-gray-500">
        {{ t('story.fields.' + f) }}
        <textarea v-model="selectedRecord[f]" rows="2" class="mt-1 w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-100 focus:border-blue-500 focus:outline-none" />
      </label>
    </div>

    <!-- relationships -->
    <div class="mb-5">
      <div class="flex items-center justify-between mb-1">
        <label class="text-[11px] uppercase tracking-wide text-gray-500">{{ t('story.fields.relationships') }}</label>
        <button @click="addRel" class="text-[11px] text-blue-400 hover:text-blue-300">＋ {{ t('story.add') }}</button>
      </div>
      <div v-for="(r, i) in selectedRecord.relationships" :key="i" class="flex gap-2 mb-1">
        <input v-model="r.kind" placeholder="mentor-of" class="w-40 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100" />
        <select v-model="r.to" class="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100">
          <option value="">—</option>
          <option v-for="c in story.characters.value" :key="c.id" :value="c.id">{{ c.id }}</option>
        </select>
        <button @click="delRel(Number(i))" class="text-gray-500 hover:text-red-400 px-1">×</button>
      </div>
    </div>

    <!-- engine NPC bindings -->
    <div class="mb-6">
      <div class="flex items-center justify-between mb-1">
        <label class="text-[11px] uppercase tracking-wide text-gray-500">{{ t('story.fields.npcBindings') }}</label>
        <button @click="addNpc" class="text-[11px] text-blue-400 hover:text-blue-300">＋ {{ t('story.add') }}</button>
      </div>
      <div v-for="(n, i) in selectedRecord.engine.npcs" :key="i" class="flex gap-2 mb-1">
        <input v-model="n.map" placeholder="MapName" class="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100" />
        <input v-model.number="n.npcId" type="number" placeholder="npcId" class="w-24 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100" />
        <button @click="delNpc(Number(i))" class="text-gray-500 hover:text-red-400 px-1">×</button>
      </div>
    </div>

    <!-- AI refine panel -->
    <div class="border border-blue-900/40 bg-blue-950/20 rounded-lg p-4">
      <div class="flex items-center gap-2 mb-2">
        <span class="text-sm">✨</span>
        <h3 class="text-sm font-semibold text-blue-300">{{ t('story.ai.refineTitle') }}</h3>
      </div>
      <p class="text-[11px] text-gray-400 mb-3">{{ t('story.ai.refineDesc') }}</p>
      <div class="flex items-center gap-2 mb-3">
        <select v-model="providerId" class="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100">
          <option value="">{{ t('story.ai.selectProvider') }}</option>
          <option v-for="p in providers" :key="p.id" :value="p.id">{{ p.id }} ({{ p.model }})</option>
        </select>
        <button
          @click="refine"
          :disabled="aiBusy || !providerId"
          class="px-3 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40"
        >
          {{ aiBusy ? t('story.ai.working') : t('story.ai.refine') }}
        </button>
        <button v-if="!providers.length" @click="nav.goToType('settings')" class="text-[11px] text-blue-400 hover:text-blue-300">
          {{ t('story.ai.addProvider') }}
        </button>
      </div>

      <p v-if="aiError" class="text-xs text-red-400 mb-2">{{ aiError }}</p>

      <div v-if="proposal" class="space-y-2">
        <div v-for="c in proposalChanges" :key="c.key" class="text-xs">
          <div class="text-[10px] uppercase tracking-wide text-blue-400">{{ c.key }}</div>
          <div class="text-gray-300 bg-gray-800/60 rounded px-2 py-1 whitespace-pre-wrap">{{ c.value }}</div>
        </div>
        <div v-if="proposal.spriteSpec" class="text-xs">
          <div class="text-[10px] uppercase tracking-wide text-blue-400">spriteSpec</div>
          <pre class="text-gray-400 bg-gray-800/60 rounded px-2 py-1 overflow-x-auto text-[10px]">{{ JSON.stringify(proposal.spriteSpec, null, 2) }}</pre>
        </div>
        <div v-if="!aiBusy" class="flex gap-2 pt-1">
          <button @click="acceptProposal" class="px-3 py-1 text-xs rounded bg-green-700 text-white hover:bg-green-600">{{ t('story.ai.accept') }}</button>
          <button @click="proposal = null" class="px-3 py-1 text-xs rounded text-gray-400 hover:text-gray-200">{{ t('story.ai.discard') }}</button>
        </div>
      </div>

    </div>

    <AiKeyPrompt v-if="showKeyPrompt" :provider-id="providerId" @submit="onKeySubmit" @cancel="showKeyPrompt = false" />
  </div>

  <div v-else class="h-full flex items-center justify-center text-gray-600 text-sm">
    {{ t('story.selectOrCreate') }}
  </div>
</template>

<style scoped>
.sprite-checker {
  background-image:
    linear-gradient(45deg, #3a3a3a 25%, transparent 25%),
    linear-gradient(-45deg, #3a3a3a 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #3a3a3a 75%),
    linear-gradient(-45deg, transparent 75%, #3a3a3a 75%);
  background-size: 12px 12px;
  background-position: 0 0, 0 6px, 6px -6px, -6px 0;
  background-color: #2a2a2a;
}
</style>
