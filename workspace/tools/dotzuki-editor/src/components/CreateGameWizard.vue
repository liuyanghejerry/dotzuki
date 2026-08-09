<template>
  <div class="flex-1 flex items-center justify-center bg-gray-900 p-4">
    <div class="w-full max-w-xl">
      <!-- Step Indicator -->
      <div class="flex items-center justify-center gap-2 mb-8">
        <template v-for="(step, i) in steps" :key="step.label">
          <div class="flex items-center gap-2">
            <!-- Circle -->
            <div
              :class="[
                'w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors',
                i + 1 === currentStep
                  ? 'bg-blue-600 text-white ring-2 ring-blue-500/50'
                  : i + 1 < currentStep
                    ? 'bg-green-600 text-white'
                    : 'bg-gray-700 text-gray-500'
              ]"
            >
              <span v-if="i + 1 < currentStep">&#10003;</span>
              <span v-else>{{ i + 1 }}</span>
            </div>
            <span
              :class="[
                'text-sm transition-colors',
                i + 1 === currentStep ? 'text-blue-400 font-medium' : 'text-gray-500'
              ]"
            >
              {{ step.label }}
            </span>
          </div>
          <!-- Connector line -->
          <div
            v-if="i < steps.length - 1"
            :class="[
              'w-8 h-px transition-colors',
              i + 1 < currentStep ? 'bg-green-600' : 'bg-gray-700'
            ]"
          />
        </template>
      </div>

      <!-- Card -->
      <div class="bg-gray-800 border border-gray-700 rounded-lg shadow-xl">
        <!-- Step 1: Name Your Game -->
        <div v-if="currentStep === 1" class="p-6 space-y-5">
          <h2 class="text-xl font-bold text-gray-100">{{ $t('wizard.step1') }}</h2>
          <p class="text-sm text-gray-400">
            {{ $t('wizard.step1Desc') }}
          </p>
          <input
            ref="nameInput"
            v-model="gameName"
            type="text"
            :placeholder="$t('wizard.namePlaceholder')"
            class="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded text-gray-100 text-base
                   placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30
                   transition-colors"
            @keyup.enter="nextStep"
          />

          <!-- Directory name — defaults to a slug of the game name -->
          <div class="space-y-1.5">
            <label class="block text-xs font-medium text-gray-400">{{ $t('wizard.dirLabel') }}</label>
            <div class="flex gap-2">
              <input
                v-model="dirName"
                type="text"
                @input="dirTouched = true"
                :placeholder="$t('wizard.dirPlaceholder')"
                :class="[
                  'flex-1 px-3 py-2 bg-gray-700 border rounded text-sm text-gray-100 placeholder-gray-500',
                  'focus:outline-none transition-colors',
                  dirValid
                    ? 'border-gray-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30'
                    : 'border-red-600 focus:border-red-500'
                ]"
                @keyup.enter="nextStep"
              />
              <!-- Electron only: pick a parent folder other than the default root -->
              <button
                v-if="canBrowse"
                @click="browseParentDir"
                class="px-3 py-2 rounded text-sm bg-gray-700 hover:bg-gray-600 text-gray-200
                       border border-gray-600 transition-colors whitespace-nowrap"
              >
                {{ $t('wizard.browse') }}
              </button>
            </div>
            <p v-if="!dirValid" class="text-xs text-red-400">{{ $t('wizard.dirInvalid') }}</p>
            <p class="text-xs text-gray-500 break-all">{{ $t('wizard.dirPreview') }} {{ fullTargetPath }}</p>
          </div>

          <div class="flex justify-end">
            <button
              :disabled="!canProceedStep1"
              @click="nextStep"
              :class="[
                'px-5 py-2.5 rounded text-sm font-medium transition-colors',
                canProceedStep1
                  ? 'bg-blue-600 hover:bg-blue-700 text-white cursor-pointer'
                  : 'bg-gray-700 text-gray-500 cursor-not-allowed'
              ]"
            >
              {{ $t('wizard.next') }}
            </button>
          </div>
        </div>

        <!-- Step 2: Choose Template -->
        <div v-else-if="currentStep === 2" class="p-6 space-y-5">
          <h2 class="text-xl font-bold text-gray-100">{{ $t('wizard.step2') }}</h2>
          <p class="text-sm text-gray-400">
            {{ $t('wizard.step2Desc') }}
          </p>

          <!-- Loading -->
          <div v-if="templatesLoading" class="flex items-center justify-center py-12">
            <div class="flex items-center gap-2 text-gray-500">
              <svg class="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span class="text-sm">{{ $t('wizard.loadingTemplates') }}</span>
            </div>
          </div>

          <!-- Template Grid -->
          <div v-else class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <button
              v-for="tpl in templates"
              :key="tpl.id"
              @click="selectedTemplate = tpl.id"
              :class="[
                'p-4 rounded-lg border-2 text-left transition-all',
                selectedTemplate === tpl.id
                  ? 'border-blue-500 bg-blue-500/10 shadow-[0_0_12px_rgba(59,130,246,0.25)]'
                  : 'border-gray-700 bg-gray-700/50 hover:border-gray-600 hover:bg-gray-700'
              ]"
            >
              <div class="text-2xl mb-2">{{ iconFor(tpl.icon) }}</div>
              <div
                :class="[
                  'text-sm font-semibold mb-1 transition-colors',
                  selectedTemplate === tpl.id ? 'text-blue-400' : 'text-gray-200'
                ]"
              >
                {{ tpl.name }}
              </div>
              <div class="text-xs text-gray-500 leading-relaxed">{{ tpl.description }}</div>
            </button>
          </div>

          <!-- Empty state if no templates returned -->
          <div v-if="!templatesLoading && templates.length === 0" class="text-center py-8 text-gray-500 text-sm">
            {{ $t('wizard.noTemplates') }}
          </div>

          <div class="flex justify-between pt-2">
            <button
              @click="currentStep = 1"
              class="px-5 py-2.5 rounded text-sm font-medium bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors"
            >
              {{ $t('wizard.back') }}
            </button>
            <button
              @click="nextStep"
              class="px-5 py-2.5 rounded text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors"
            >
              {{ $t('wizard.next') }}
            </button>
          </div>
        </div>

        <!-- Step 3: Review & Create -->
        <div v-else-if="currentStep === 3" class="p-6 space-y-5">
          <h2 class="text-xl font-bold text-gray-100">{{ $t('wizard.step3') }}</h2>
          <p class="text-sm text-gray-400">
            {{ $t('wizard.step3Desc') }}
          </p>

          <!-- Summary Card -->
          <div class="bg-gray-700/50 border border-gray-700 rounded-lg p-4 space-y-3">
            <div class="flex justify-between items-baseline">
              <span class="text-sm text-gray-400">{{ $t('wizard.summaryName') }}</span>
              <span class="text-sm font-semibold text-gray-100">{{ gameName }}</span>
            </div>
            <div class="flex justify-between items-baseline">
              <span class="text-sm text-gray-400">{{ $t('wizard.summaryTemplate') }}</span>
              <span class="text-sm font-semibold text-gray-100">{{ selectedTemplateName }}</span>
            </div>
            <div class="flex justify-between items-baseline gap-4">
              <span class="text-sm text-gray-400 shrink-0">{{ $t('wizard.summaryDir') }}</span>
              <span class="text-sm font-semibold text-gray-100 break-all text-right">{{ fullTargetPath }}</span>
            </div>
            <hr class="border-gray-600" />
            <div>
              <span class="text-sm text-gray-400">{{ $t('wizard.summary') }}</span>
              <ul class="mt-2 space-y-1 text-xs text-gray-300">
                <li class="flex items-center gap-2">
                  <span class="text-blue-400">&#x2022;</span> {{ $t('wizard.summaryConfig') }}
                </li>
                <li class="flex items-center gap-2">
                  <span class="text-blue-400">&#x2022;</span> {{ $t('wizard.summaryDirs') }}
                </li>
                <li class="flex items-center gap-2">
                  <span class="text-blue-400">&#x2022;</span> {{ $t('wizard.summaryAssets') }}
                </li>
              </ul>
            </div>
          </div>

          <!-- Error message -->
          <div
            v-if="createError"
            class="bg-red-900/30 border border-red-800 rounded-lg p-3 text-sm text-red-400"
          >
            {{ createError }}
          </div>

          <!-- Success message -->
          <div
            v-if="createSuccess"
            class="bg-green-900/30 border border-green-800 rounded-lg p-3 text-sm text-green-400 flex items-center gap-2"
          >
            <span>&#10003;</span> {{ $t('wizard.created') }}
          </div>

          <!-- What's inside: friendly summary of the scaffolded files -->
          <div
            v-if="createSuccess && fileGroups.length > 0"
            class="bg-gray-700/50 border border-gray-700 rounded-lg p-4"
          >
            <span class="text-sm text-gray-400">{{ $t('wizard.includesTitle') }}</span>
            <ul class="mt-2 space-y-1 text-xs text-gray-300">
              <li v-for="group in fileGroups" :key="group.key" class="flex items-center gap-2">
                <span class="text-blue-400">&#x2022;</span> {{ $t(group.key, { count: group.count }) }}
              </li>
            </ul>
          </div>

          <!-- First steps: where to go from here -->
          <div
            v-if="createSuccess"
            class="bg-gray-700/50 border border-gray-700 rounded-lg p-4"
          >
            <span class="text-sm text-gray-400">{{ $t('wizard.firstStepsTitle') }}</span>
            <ol class="mt-2 space-y-1 text-xs text-gray-300 list-decimal list-inside">
              <li v-for="hint in firstSteps" :key="hint">{{ $t(hint) }}</li>
            </ol>
          </div>

          <div v-if="!createSuccess" class="flex justify-between pt-2">
            <button
              :disabled="creating"
              @click="currentStep = 2"
              class="px-5 py-2.5 rounded text-sm font-medium bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {{ $t('wizard.back') }}
            </button>
            <button
              :disabled="creating"
              @click="handleCreate"
              :class="[
                'px-5 py-2.5 rounded text-sm font-medium transition-colors flex items-center gap-2',
                creating
                  ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 text-white cursor-pointer'
              ]"
            >
              <!-- Spinner -->
              <svg v-if="creating" class="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              {{ creating ? $t('wizard.creating') : $t('wizard.create') }}
            </button>
          </div>

          <!-- Next steps after a successful create -->
          <div v-else class="flex justify-end gap-2 pt-2">
            <button
              @click="emit('created', false)"
              class="px-5 py-2.5 rounded text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors"
            >
              {{ $t('wizard.openEditor') }}
            </button>
            <button
              @click="emit('created', true)"
              class="px-5 py-2.5 rounded text-sm font-medium bg-purple-600 hover:bg-purple-700 text-white transition-colors"
            >
              {{ $t('wizard.createWithAi') }}
            </button>
          </div>
        </div>
      </div>

      <!-- Manual hint -->
      <p class="text-center mt-4 text-xs text-gray-600">
        {{ $t('welcome.manualHint') }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'

// ── Types ────────────────────────────────────────────────────────────────────

interface Template {
  id: string
  name: string
  description: string
  icon: string
  tables?: string[]
}

interface CreatePayload {
  name: string
  template: string
  dir: string
  dataRoot: string
  gfxRoot: string
}

const { t, locale } = useI18n()

// ── Emits ────────────────────────────────────────────────────────────────────

const emit = defineEmits<{
  /** Project created; `withAi` asks the app to also open the AI assistant. */
  created: [withAi: boolean]
}>()

// ── Steps ────────────────────────────────────────────────────────────────────

const steps = computed(() => [
  { label: t('wizard.step1') },
  { label: t('wizard.step2') },
  { label: t('wizard.step3') },
])

const currentStep = ref(1)
const gameName = ref('My Awesome RPG')
const selectedTemplate = ref('empty')
const nameInput = ref<HTMLInputElement | null>(null)

// ── Target directory ─────────────────────────────────────────────────────────

const dirName = ref('')
// Once the user edits the folder name by hand, stop auto-slugging the game name.
const dirTouched = ref(false)
// Parent folder chosen via the Electron "Browse…" dialog; empty = project root.
const baseDir = ref('')
const projectRoot = ref('')

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '')
}

watch(gameName, (name) => {
  if (!dirTouched.value) dirName.value = slugify(name)
})

const dirValid = computed(() => /^[a-z0-9][a-z0-9-]*$/.test(dirName.value))
const canProceedStep1 = computed(() => !!gameName.value.trim() && dirValid.value)

const fullTargetPath = computed(() => {
  const base = baseDir.value || projectRoot.value
  const dir = dirName.value || '…'
  return base ? `${base}/${dir}` : dir
})

// The parent-folder picker only exists under Electron (see electron/preload.cjs).
const canBrowse = computed(() => typeof window !== 'undefined' && !!window.jrpgDesktop?.pickDirectory)

async function browseParentDir() {
  const res = await window.jrpgDesktop?.pickDirectory?.()
  if (res?.ok && res.path) baseDir.value = res.path
}

async function fetchProjectRoot() {
  try {
    const resp = await fetch('/api/project/root')
    if (resp.ok) projectRoot.value = (await resp.json()).projectRoot ?? ''
  } catch {
    // Preview only — projectRoot stays empty and the hint shows just the slug.
  }
}

// ── Templates ────────────────────────────────────────────────────────────────

const templates = ref<Template[]>([])
const templatesLoading = ref(false)
const templatesError = ref<string | null>(null)

/** Display name of the selected template (the id itself as a fallback). */
const selectedTemplateName = computed(() =>
  templates.value.find(tpl => tpl.id === selectedTemplate.value)?.name ?? selectedTemplate.value
)

async function fetchTemplates() {
  templatesLoading.value = true
  templatesError.value = null
  try {
    const resp = await fetch(`/api/project/templates?lang=${encodeURIComponent(locale.value)}`)
    if (!resp.ok) {
      const msg = await resp.json().then(j => j.error).catch(() => 'Unknown error')
      throw new Error(msg)
    }
    templates.value = await resp.json()
    // Default select first template if available
    if (templates.value.length > 0) {
      selectedTemplate.value = templates.value[0].id
    }
  } catch (e) {
    templatesError.value = e instanceof Error ? e.message : t('wizard.errorLoadTemplates')
    // Fallback templates so the user isn't stuck
    templates.value = [
      { id: 'empty', name: t('templates.empty.name'), description: t('templates.empty.desc'), icon: 'blank' },
      { id: 'wuxia', name: t('templates.wuxia.name'), description: t('templates.wuxia.desc'), icon: 'sword' },
      { id: 'dotzuki', name: t('templates.jrpg.name'), description: t('templates.jrpg.desc'), icon: 'star' },
    ]
    selectedTemplate.value = templates.value[0].id
  } finally {
    templatesLoading.value = false
  }
}

function iconFor(icon: string): string {
  const map: Record<string, string> = {
    blank: '📄',
    sword: '⚔️',
    star: '⭐',
    map: '🗺',
    data: '📊',
    default: '📄',
  }
  return map[icon] ?? map.default
}

// ── Create ───────────────────────────────────────────────────────────────────

const creating = ref(false)
const createError = ref<string | null>(null)
const createSuccess = ref(false)
// Project-relative paths of every file the scaffolder wrote (from the create
// response's `files` field); empty when the server omits it.
const createdFiles = ref<string[]>([])

interface FileGroup {
  /** i18n key under `wizard.*` — receives `{ count }`. */
  key: string
  count: number
}

/** Friendly "what's inside" summary derived from the scaffolded file paths. */
const fileGroups = computed<FileGroup[]>(() => {
  const files = createdFiles.value
  if (files.length === 0) return []
  const isMap = (f: string) => f.startsWith('data/maps/')
  const isScene = (f: string) => f.startsWith('assets/scenes/')
  const isStory = (f: string) => f.startsWith('data/stories/')
  const isGfx = (f: string) => f.startsWith('gfx/')
  const isRecord = (f: string) => f.startsWith('data/') && !isMap(f) && !isStory(f)
  const groups: FileGroup[] = []
  const push = (key: string, count: number) => { if (count > 0) groups.push({ key, count }) }
  push('wizard.includesMaps', files.filter(isMap).length)
  push('wizard.includesRecords', files.filter(isRecord).length)
  push('wizard.includesScenes', files.filter(isScene).length)
  push('wizard.includesStory', files.filter(isStory).length)
  push('wizard.includesGfx', files.filter(isGfx).length)
  return groups
})

/** First-step hints, tailored to what was actually scaffolded. */
const firstSteps = computed<string[]>(() => {
  const hints: string[] = []
  if (fileGroups.value.some(g => g.key === 'wizard.includesMaps')) hints.push('wizard.firstStepMap')
  if (fileGroups.value.some(g => g.key === 'wizard.includesScenes')) hints.push('wizard.firstStepScript')
  hints.push('wizard.firstStepAi')
  return hints
})

async function handleCreate() {
  creating.value = true
  createError.value = null
  createSuccess.value = false

  try {
    const payload: CreatePayload = {
      name: gameName.value.trim(),
      template: selectedTemplate.value,
      // With an Electron-picked parent folder the server gets an absolute path.
      dir: baseDir.value ? `${baseDir.value}/${dirName.value}` : dirName.value,
      dataRoot: './data',
      gfxRoot: './gfx',
    }

    const resp = await fetch('/api/project/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!resp.ok) {
      const msg = await resp.json().then(j => j.error).catch(() => t('wizard.errorCreate'))
      throw new Error(msg)
    }

    // The success panel offers the next step (editor / AI) — no auto-redirect.
    // `files` (project-relative paths of every scaffolded file) feeds the
    // "what's inside" summary; be defensive if the server omits it.
    const data = await resp.json().catch(() => null)
    createdFiles.value = Array.isArray(data?.files)
      ? data.files.filter((f: unknown): f is string => typeof f === 'string')
      : []
    createSuccess.value = true
  } catch (e) {
    createError.value = e instanceof Error ? e.message : t('wizard.errorUnexpected')
  } finally {
    creating.value = false
  }
}

// ── Navigation ───────────────────────────────────────────────────────────────

function nextStep() {
  if (currentStep.value === 1 && !canProceedStep1.value) return
  if (currentStep.value < 3) {
    currentStep.value++
    if (currentStep.value === 2 && templates.value.length === 0) {
      fetchTemplates()
    }
  }
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

onMounted(() => {
  dirName.value = slugify(gameName.value)
  fetchProjectRoot()
  // Auto-focus name input on mount
  nextTick(() => {
    nameInput.value?.focus()
  })
})
</script>
