<template>
  <div class="flex-1 flex items-center justify-center bg-gray-900 p-4">
    <!-- Wizard mode: show the inline wizard with a back link -->
    <div v-if="showWizard" class="flex flex-col flex-1 w-full">
      <div class="flex justify-center pt-4 pb-2">
        <button
          @click="showWizard = false"
          class="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200 bg-gray-800 border border-gray-700 rounded hover:bg-gray-700 transition-colors"
        >
          {{ $t('welcome.back') }}
        </button>
      </div>
      <CreateGameWizard @created="onWizardCreated" />
    </div>

    <!-- AI chat mode: the assistant panel embedded (project-creation mode) -->
    <div v-else-if="showAiChat" class="flex flex-col flex-1 w-full min-h-0">
      <div class="flex justify-center pt-4 pb-2 shrink-0">
        <button
          @click="closeAiChat"
          class="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200 bg-gray-800 border border-gray-700 rounded hover:bg-gray-700 transition-colors"
        >
          {{ $t('welcome.back') }}
        </button>
      </div>
      <div class="flex-1 min-h-0 px-4 pb-4 flex flex-col">
        <AssistantPanel welcome :initial-message="aiInitialMessage" @scaffold-applied="onAiScaffoldApplied" @close="closeAiChat" />
      </div>
    </div>

    <!-- Default mode: task-first hero, then recent projects, secondary entries last -->
    <div v-else class="w-full space-y-8" :class="hasProvider ? 'max-w-2xl' : 'max-w-4xl'">
      <!-- ── No AI provider configured yet: show provider-setup card + wizard.
             The user must connect an LLM before the AI hero path is available. ── -->
      <div v-if="!hasProvider" class="grid gap-4 sm:grid-cols-2 pt-8">
        <!-- Provider setup card -->
        <div class="bg-gray-800 border border-gray-700 rounded-lg p-5 flex flex-col">
          <h1 class="text-lg font-bold text-amber-400 mb-1">{{ $t('welcome.providerCardTitle') }}</h1>
          <p class="text-xs text-gray-400 mb-4 leading-snug">{{ $t('welcome.providerCardDesc') }}</p>

          <div class="space-y-2.5 flex-1">
            <select v-model="qpVendor" @change="onVendorChange"
              :aria-label="$t('assistant.quickSetup.vendor')"
              class="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-100 focus:border-blue-500 focus:outline-none">
              <option v-for="p in PROVIDER_PRESETS" :key="p.id" :value="p.id">
                {{ p.id === 'custom' ? $t('assistant.quickSetup.vendorCustom') : p.label }}
              </option>
            </select>

            <input v-model="qp.id" :placeholder="$t('assistant.quickSetup.name')"
              class="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-100 focus:border-blue-500 focus:outline-none" />

            <input v-model="qp.baseURL"
              :placeholder="qpPreset.baseURL ? qpPreset.baseURL : $t('assistant.quickSetup.baseUrl')"
              class="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-100 focus:border-blue-500 focus:outline-none" />

            <input v-model="qp.model"
              :placeholder="qpPreset.modelExample ? $t('assistant.quickSetup.modelExample', { model: qpPreset.modelExample }) : $t('assistant.quickSetup.model')"
              class="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-100 focus:border-blue-500 focus:outline-none" />

            <div class="flex items-center gap-2">
              <input v-model="qp.key" type="password" :placeholder="$t('assistant.quickSetup.key')"
                class="flex-1 min-w-0 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-100 focus:border-blue-500 focus:outline-none" />
              <a v-if="qpPreset.keyUrl" :href="qpPreset.keyUrl" target="_blank" rel="noopener noreferrer"
                class="shrink-0 text-[10px] text-blue-400 hover:text-blue-300 whitespace-nowrap">
                {{ $t('assistant.quickSetup.getKey') }}
              </a>
            </div>
          </div>

          <div class="mt-4 space-y-2">
            <button
              @click="saveAndContinue"
              :disabled="!qpReady || qpSaving"
              class="w-full px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              :class="qpReady && !qpSaving
                ? 'bg-blue-600 hover:bg-blue-700 text-white cursor-pointer'
                : 'bg-gray-700 text-gray-500 cursor-not-allowed'"
            >
              <span v-if="qpSaving" class="flex items-center justify-center gap-1.5">
                <svg class="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                {{ $t('welcome.providerSaving') }}
              </span>
              <span v-else>{{ $t('welcome.providerSave') }}</span>
            </button>
            <div v-if="qpError" class="text-[11px] text-red-400 text-center">{{ qpError }}</div>
            <div v-if="savedProvider" class="text-[11px] text-emerald-400 text-center">{{ savedProvider }}</div>
            <button
              @click="showWizard = true"
              class="w-full text-xs text-gray-400 hover:text-gray-200 transition-colors text-center"
            >
              {{ $t('welcome.skipAi') }}
            </button>
          </div>
        </div>

        <!-- Wizard card -->
        <div class="bg-gray-800 border border-gray-700 rounded-lg p-5 flex flex-col">
          <h2 class="text-lg font-bold text-gray-100 mb-3">{{ $t('welcome.wizardCardTitle') }}</h2>
          <p class="text-sm text-gray-400 flex-1">{{ $t('welcome.wizardCardDesc') }}</p>
          <div class="mt-3">
            <button
              @click="showWizard = true"
              class="px-8 py-2.5 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
            >
              {{ $t('welcome.wizardCardButton') }}
            </button>
          </div>
        </div>
      </div>

      <!-- ── Hero: describe your game in one line, the AI takes it from there ── -->
      <div v-else class="pt-8">
        <h1 class="text-2xl font-bold text-gray-100 text-center mb-5">{{ $t('welcome.heroTitle') }}</h1>
        <textarea
          v-model="heroText"
          rows="3"
          :placeholder="$t('welcome.heroPlaceholder')"
          @keydown.enter.exact="onHeroKeydown"
          class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100
                 placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1
                 focus:ring-blue-500/30 transition-colors resize-none"
        />
        <div class="mt-3 flex justify-center">
          <button
            :disabled="!heroText.trim()"
            @click="startWithAi"
            :class="[
              'px-8 py-2.5 rounded-lg text-sm font-medium transition-colors',
              heroText.trim()
                ? 'bg-blue-600 hover:bg-blue-700 text-white cursor-pointer'
                : 'bg-gray-700 text-gray-500 cursor-not-allowed'
            ]"
          >
            {{ $t('welcome.heroStart') }}
          </button>
        </div>
      </div>

      <!-- ── Recent Projects: jump back in ── -->
      <div v-if="recentProjects.length > 0">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-sm font-medium text-gray-400">{{ $t('welcome.recentContinue') }}</h3>
          <button
            @click="clearRecentProjects"
            class="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            {{ $t('welcome.recentClear') }}
          </button>
        </div>

        <div class="border border-gray-700 rounded-lg overflow-hidden">
          <button
            v-for="proj in recentProjects"
            :key="proj.path"
            @click="openRecentProject(proj.path)"
            class="w-full flex items-center justify-between px-4 py-3 text-left
                   hover:bg-gray-700/70 transition-colors border-b border-gray-700/50
                   last:border-b-0"
          >
            <div class="flex items-center gap-3 min-w-0">
              <svg class="w-4 h-4 text-gray-500 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M2 6a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1H8a3 3 0 00-3 3v1.468A1.997 1.997 0 004 15v-1a1 1 0 011-1h12a1 1 0 011 1v2a2 2 0 01-2 2H5a3 3 0 01-3-3V6z" clip-rule="evenodd"/>
              </svg>
              <div class="text-left min-w-0">
                <div class="text-sm text-gray-200 truncate">{{ proj.name }}</div>
                <div class="text-xs text-gray-500 truncate">{{ proj.path }}</div>
              </div>
            </div>
          </button>
        </div>
      </div>

      <!-- ── Secondary entries: wizard + open-by-path (low visual weight) ── -->
      <div class="space-y-3">
        <div class="flex items-center justify-center gap-3 text-sm">
          <!-- without a provider the wizard is already a hero-level card above -->
          <template v-if="hasProvider">
            <button
              @click="showWizard = true"
              class="text-gray-400 hover:text-gray-200 transition-colors"
            >
              {{ $t('welcome.secondaryWizard') }}
            </button>
            <span class="text-gray-700">·</span>
          </template>
          <button
            @click="showOpenRow = !showOpenRow"
            class="text-gray-400 hover:text-gray-200 transition-colors"
          >
            {{ $t('welcome.secondaryOpen') }}
          </button>
        </div>

        <!-- Open-by-path row: expands under the secondary links, reuses the old card logic -->
        <div v-if="showOpenRow" class="space-y-3">
          <div class="flex gap-2">
            <input
              v-model="openPath"
              type="text"
              :placeholder="$t('welcome.openPlaceholder')"
              class="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm text-gray-100
                     placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1
                     focus:ring-blue-500/30 transition-colors"
              @keyup.enter="handleOpenProject"
            />
            <button
              v-if="canBrowse"
              :disabled="browsing"
              @click="handleBrowseProject"
              class="px-4 py-2 rounded text-sm font-medium border border-gray-600 text-gray-300
                     hover:bg-gray-600 hover:text-white transition-colors whitespace-nowrap
                     disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg v-if="!browsing" class="w-4 h-4 inline-block mr-1" viewBox="0 0 20 20" fill="currentColor">
                <path d="M2 6a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1H8a3 3 0 00-3 3v1.468A1.997 1.997 0 004 15v-1a1 1 0 011-1h12a1 1 0 011 1v2a2 2 0 01-2 2H5a3 3 0 01-3-3V6z"/>
              </svg>
              {{ $t('welcome.openBrowse') }}
            </button>
            <button
              :disabled="!openPath.trim() || opening"
              @click="handleOpenProject"
              :class="[
                'px-4 py-2 rounded text-sm font-medium transition-colors whitespace-nowrap',
                openPath.trim() && !opening
                  ? 'bg-blue-600 hover:bg-blue-700 text-white cursor-pointer'
                  : 'bg-gray-700 text-gray-500 cursor-not-allowed'
              ]"
            >
              <span v-if="!opening">{{ $t('welcome.openButton') }}</span>
              <svg v-else class="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
            </button>
          </div>

          <!-- Open error -->
          <div
            v-if="openError"
            class="bg-red-900/30 border border-red-800 rounded p-2.5 text-xs text-red-400"
          >
            {{ openError }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import CreateGameWizard from './CreateGameWizard.vue'
import AssistantPanel from './assistant/AssistantPanel.vue'
import { useQuickProviderSetup } from '@/composables/useQuickProviderSetup'
import { PROVIDER_PRESETS } from '@/components/assistant/providerPresets'
import type { ProjectConfig } from '@/types'

const { t } = useI18n()

// ── Quick provider setup (shared composable) ──────────────────────────────
const {
  qpVendor, qpPreset, qp, qpSaving, qpError, qpReady,
  onVendorChange, saveQuickProvider,
} = useQuickProviderSetup()
const savedProvider = ref('')

async function saveAndContinue() {
  const id = await saveQuickProvider()
  if (id) {
    savedProvider.value = t('welcome.providerSaved')
    await checkProviders()
    // Re-checking hasProvider flips the view to the hero textarea
  }
}

// ── Emits ──────────────────────────────────────────────────────────────────────

const emit = defineEmits<{
  created: [withAi?: boolean]
  opened: [config: ProjectConfig]
}>()

// ── Wizard state ───────────────────────────────────────────────────────────────

const showWizard = ref(false)

function onWizardCreated(withAi?: boolean) {
  emit('created', withAi)
}

// ── AI chat (project-creation mode) ────────────────────────────────────────────

const showAiChat = ref(false)

// Hero prompt handoff: the one-line pitch is passed to the assistant panel as
// its initial message and reset when the chat closes, so it is consumed once.
const heroText = ref('')
const aiInitialMessage = ref('')

function startWithAi() {
  const text = heroText.value.trim()
  if (!text) return
  aiInitialMessage.value = text
  showAiChat.value = true
}

function onHeroKeydown(e: KeyboardEvent) {
  // Enter pressed to confirm an IME candidate must not submit.
  if (e.isComposing) return
  e.preventDefault()
  startWithAi()
}

function closeAiChat() {
  showAiChat.value = false
  aiInitialMessage.value = ''
  heroText.value = ''
}

// The assistant's scaffold proposal was applied: the project now exists — open
// it (withAi keeps the assistant panel open so the conversation continues).
function onAiScaffoldApplied() {
  emit('created', true)
}

// ── Open Project ───────────────────────────────────────────────────────────────

const openPath = ref('')
const opening = ref(false)
const openError = ref<string | null>(null)
const showOpenRow = ref(false)
const browsing = ref(false)

/** Whether the native folder picker is available (Electron only). */
const canBrowse = computed(() => typeof window !== 'undefined' && !!window.jrpgDesktop?.openProject)

async function handleOpenProject() {
  const path = openPath.value.trim()
  if (!path || opening.value) return

  opening.value = true
  openError.value = null

  try {
    const resp = await fetch('/api/project/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    })

    if (!resp.ok) {
      const msg = await resp.json().then(j => j.error).catch(() => 'Unknown error')
      throw new Error(msg)
    }

    const data = await resp.json()
    addRecentProject(data.config.name, path)
    emit('opened', data.config)
  } catch (e) {
    // Server errors arrive in English — prefix a localized lead-in.
    const msg = e instanceof Error ? e.message : ''
    openError.value = msg ? `${t('welcome.openErrorPrefix')} ${msg}` : t('welcome.openError')
  } finally {
    opening.value = false
  }
}

function openRecentProject(path: string) {
  openPath.value = path
  handleOpenProject()
}

/**
 * Native folder picker via Electron IPC.
 * On success the Electron main process calls win.webContents.reload() itself,
 * so the page refreshes automatically with the opened project. We only handle
 * the error path here.
 */
async function handleBrowseProject() {
  if (browsing.value) return
  browsing.value = true
  openError.value = null
  try {
    const res = await window.jrpgDesktop?.openProject?.()
    if (!res) return
    if (!res.ok && res.error) {
      openError.value = res.error
    }
  } catch (e) {
    openError.value = String(e)
  } finally {
    browsing.value = false
  }
}

// ── Recent Projects ────────────────────────────────────────────────────────────

interface RecentProject {
  path: string
  name: string
}

const STORAGE_KEY = 'dotzuki-editor-recent-projects'
const MAX_RECENT = 5

const recentProjects = ref<RecentProject[]>([])

function loadRecentProjects(): RecentProject[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (p: unknown): p is RecentProject =>
        typeof p === 'object' &&
        p !== null &&
        typeof (p as RecentProject).path === 'string' &&
        typeof (p as RecentProject).name === 'string'
    )
  } catch {
    return []
  }
}

function saveRecentProjects(list: RecentProject[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

function addRecentProject(name: string, path: string) {
  const list = loadRecentProjects()
  // Remove duplicate if exists, then prepend
  const filtered = list.filter(p => p.path !== path)
  filtered.unshift({ name, path })
  // Trim to max
  const trimmed = filtered.slice(0, MAX_RECENT)
  recentProjects.value = trimmed
  saveRecentProjects(trimmed)
}

function clearRecentProjects() {
  recentProjects.value = []
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

// ── First-run detection ──────────────────────────────────────────────────────
// With no AI provider configured, the hero alone is a dead end (the chat view
// demands provider setup first), so the wizard is promoted to an equal-weight
// card beside it. Checked once on mount; fetch failure counts as "no provider".
// Defaults true so returning users never see the layout flip.
const hasProvider = ref(true)

async function checkProviders() {
  try {
    const resp = await fetch('/api/ai/providers')
    const list = resp.ok ? await resp.json() : []
    hasProvider.value = Array.isArray(list) && list.length > 0
  } catch {
    hasProvider.value = false
  }
}

// ── Lifecycle ──────────────────────────────────────────────────────────────────

onMounted(() => {
  recentProjects.value = loadRecentProjects()
  // Electron File → New Project… opens the wizard.
  window.jrpgDesktop?.onNewProject?.(() => { showWizard.value = true })
  void checkProviders()
})
</script>
