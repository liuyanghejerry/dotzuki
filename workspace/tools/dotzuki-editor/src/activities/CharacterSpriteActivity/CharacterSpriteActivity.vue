<script setup lang="ts">
// ───────────────────────────────────────────────────────────────────────────
// Character Sprite Editor — standalone activity for editing character sprites.
// Each character opens as a sub-tab; the existing <SpriteStudio> component
// is embedded for each open character, providing category tabs, animated
// preview, frame grid, import/generate, and per-frame TilePixelEditor.
// ───────────────────────────────────────────────────────────────────────────
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLocalize } from '@/composables/useLocalize'
import { useEditorStore } from '@/stores/editor'
import SpriteStudio from '../StoryActivity/SpriteStudio.vue'

const { t } = useI18n()
const { localize } = useLocalize()
const editorStore = useEditorStore()

// ── Data ──
const characters = ref<any[]>([])
const loadingList = ref(false)
const loadingErr = ref('')

// ── Sub-tab system ──
interface CharTab {
  id: string       // 'char:<characterId>'
  label: string
  record: any
}
const subTabs = ref<CharTab[]>([])
const activeSubTab = ref<string | null>(null)

const activeRecord = computed(() => {
  if (!activeSubTab.value?.startsWith('char:')) return null
  const tab = subTabs.value.find(t => t.id === activeSubTab.value)
  return tab?.record ?? null
})

// ── Load character list ──
async function loadCharacters(): Promise<void> {
  loadingList.value = true
  loadingErr.value = ''
  try {
    const resp = await fetch('/api/stories/characters')
    if (!resp.ok) throw new Error(await resp.text())
    characters.value = await resp.json()
  } catch (e) {
    loadingErr.value = e instanceof Error ? e.message : 'load failed'
  } finally {
    loadingList.value = false
  }
}

// ── Open character in a sub-tab ──
async function openCharacter(char: any): Promise<void> {
  const id = `char:${char.id}`
  if (activeSubTab.value === id) return

  if (!subTabs.value.find(t => t.id === id)) {
    subTabs.value.push({ id, label: localize(char.name, char.id), record: char })
  }
  activeSubTab.value = id
}

function closeTab(tabId: string): void {
  const idx = subTabs.value.findIndex(t => t.id === tabId)
  if (idx < 0) return
  subTabs.value.splice(idx, 1)
  if (activeSubTab.value === tabId) {
    activeSubTab.value = subTabs.value[Math.min(idx, subTabs.value.length - 1)]?.id ?? null
  }
}

// ── Lifecycle ──
onMounted(async () => {
  await loadCharacters()
  // After list is loaded, consume any pending jump signal
  const pending = editorStore.pendingCharacterId
  if (pending) {
    editorStore.pendingCharacterId = null
    const char = characters.value.find(c => c.id === pending)
    if (char) openCharacter(char)
  }
})

// Jump from Story — when the editor store signals a pending character
// and the list is already loaded, open it and clear the signal.
watch(() => editorStore.pendingCharacterId, (charId) => {
  if (!charId || characters.value.length === 0) return
  editorStore.pendingCharacterId = null
  const char = characters.value.find(c => c.id === charId)
  if (char) openCharacter(char)
})
</script>

<template>
  <div class="flex h-full overflow-hidden bg-gray-900 text-gray-200">
    <!-- Sidebar: character list -->
    <aside class="w-48 bg-gray-800 border-r border-gray-700 flex flex-col shrink-0">
      <div class="px-3 py-3 border-b border-gray-700">
        <h2 class="text-xs font-semibold uppercase tracking-wider text-gray-500">{{ t('character.title') }}</h2>
      </div>
      <div class="flex-1 overflow-y-auto py-1">
        <p v-if="loadingList" class="text-xs text-gray-500 px-3 py-4">{{ t('map.loading') }}</p>
        <p v-if="loadingErr" class="text-xs text-red-400 px-3 py-4">{{ loadingErr }}</p>
        <div v-if="characters.length === 0 && !loadingList" class="text-xs text-gray-500 px-3 py-4">
          {{ t('character.noCharacters') }}
        </div>
        <button
          v-for="c in characters" :key="c.id"
          @click="openCharacter(c)"
          :class="[
            'w-full text-left px-3 py-1.5 text-sm rounded transition-colors flex items-center gap-1.5',
            activeSubTab === `char:${c.id}`
              ? 'bg-blue-600/30 text-blue-300 font-medium'
              : 'text-gray-300 hover:bg-gray-700/50 hover:text-gray-100',
          ]"
        >
          <span class="truncate flex-1">{{ localize(c.name, c.id) }}</span>
        </button>
      </div>
    </aside>

    <!-- Center: sub-tab system -->
    <div class="flex-1 flex flex-col min-w-0">
      <!-- Sub-tab bar -->
      <div class="flex items-center bg-gray-800 border-b border-gray-700 shrink-0 pl-1 pr-2 min-h-[32px] overflow-x-auto">
        <button
          v-for="tab in subTabs" :key="tab.id"
          @click="activeSubTab = tab.id"
          :class="[
            'px-3 py-1.5 text-xs border-b-2 transition-colors leading-none shrink-0 whitespace-nowrap flex items-center gap-1',
            activeSubTab === tab.id ? 'border-blue-400 text-blue-400' : 'border-transparent text-gray-400 hover:text-gray-200',
          ]"
        >
          <span>👤</span>
          <span class="truncate max-w-[120px]">{{ tab.label }}</span>
          <span
            @click.stop="closeTab(tab.id)"
            class="ml-0.5 w-3.5 h-3.5 rounded flex items-center justify-center text-[10px] leading-none hover:bg-gray-600 hover:text-gray-100"
          >×</span>
        </button>
        <div v-if="subTabs.length === 0" class="px-3 py-1.5 text-xs text-gray-500">
          {{ t('character.selectFromSidebar') }}
        </div>
      </div>

      <!-- Content: SpriteStudio for each open character (v-show keeps alive) -->
      <div class="flex-1 overflow-y-auto">
        <div v-for="tab in subTabs" :key="tab.id" v-show="activeSubTab === tab.id" class="min-h-full">
          <div class="p-4">
            <SpriteStudio :record="tab.record" embedded-pixel-editor />
          </div>
        </div>
      </div>

      <!-- Empty state -->
      <div v-if="!activeSubTab" class="flex-1 flex items-center justify-center text-sm text-gray-500">
        {{ t('character.selectFromSidebar') }}
      </div>
    </div>
  </div>
</template>
