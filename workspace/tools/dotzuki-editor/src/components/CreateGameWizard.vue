<template>
  <div class="flex-1 flex items-center justify-center bg-canvas p-4">
    <div class="w-full max-w-xl">
      <!-- Step Indicator -->
      <div class="flex items-center justify-center gap-2 mb-8">
        <template v-for="(step, i) in steps" :key="step.label">
          <div class="flex items-center gap-2">
            <!-- Circle -->
            <div
              :class="[
                'w-8 h-8 rounded-pill flex items-center justify-center text-sm font-semibold transition-colors',
                i + 1 === currentStep
                  ? 'bg-accent text-white ring-2 ring-accent-strong/50'
                  : i + 1 < currentStep
                    ? 'bg-success text-white'
                    : 'bg-raised text-ink-faint'
              ]"
            >
              <span v-if="i + 1 < currentStep">&#10003;</span>
              <span v-else>{{ i + 1 }}</span>
            </div>
            <span
              :class="[
                'text-sm transition-colors',
                i + 1 === currentStep ? 'text-accent-ink font-medium' : 'text-ink-faint'
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
              i + 1 < currentStep ? 'bg-success' : 'bg-raised'
            ]"
          />
        </template>
      </div>

      <!-- Card -->
      <div class="bg-surface border border-border rounded-card shadow-popover">
        <!-- Step 1: Name Your Game -->
        <div v-if="currentStep === 1" class="p-6 space-y-5">
          <h2 class="text-xl font-bold text-ink">{{ $t('wizard.step1') }}</h2>
          <p class="text-sm text-ink-muted">
            {{ $t('wizard.step1Desc') }}
          </p>
          <input
            ref="nameInput"
            v-model="gameName"
            type="text"
            :placeholder="$t('wizard.namePlaceholder')"
            class="w-full px-4 py-3 bg-raised border border-border-strong rounded-control text-ink text-base
                   placeholder-gray-500 focus:outline-none focus:border-accent-strong focus:ring-1 focus:ring-accent-strong/30
                   transition-colors"
            @keyup.enter="nextStep"
          />

          <!-- Directory name — defaults to a slug of the game name -->
          <div class="space-y-1.5">
            <label class="block text-xs font-medium text-ink-muted">{{ $t('wizard.dirLabel') }}</label>
            <div class="flex gap-2">
              <input
                v-model="dirName"
                type="text"
                @input="dirTouched = true"
                :placeholder="$t('wizard.dirPlaceholder')"
                :class="[
                  'flex-1 px-3 py-2 bg-raised border rounded-control text-sm text-ink placeholder-gray-500',
                  'focus:outline-none transition-colors',
                  dirValid
                    ? 'border-border-strong focus:border-accent-strong focus:ring-1 focus:ring-accent-strong/30'
                    : 'border-danger focus:border-danger-hover'
                ]"
                @keyup.enter="nextStep"
              />
              <!-- Electron only: pick a parent folder other than the default root -->
              <button
                v-if="canBrowse"
                @click="browseParentDir"
                class="px-3 py-2 rounded-control text-sm bg-raised hover:bg-overlay text-ink-secondary
                       border border-border-strong transition-colors whitespace-nowrap"
              >
                {{ $t('wizard.browse') }}
              </button>
            </div>
            <p v-if="!dirValid" class="text-xs text-danger-ink">{{ $t('wizard.dirInvalid') }}</p>
            <p class="text-xs text-ink-faint break-all">{{ $t('wizard.dirPreview') }} {{ fullTargetPath }}</p>
          </div>

          <div class="flex justify-end">
            <button
              :disabled="!canProceedStep1"
              @click="nextStep"
              :class="[
                'px-5 py-2.5 rounded-control text-sm font-medium transition-colors',
                canProceedStep1
                  ? 'bg-accent hover:bg-accent-hover text-white cursor-pointer'
                  : 'bg-raised text-ink-faint cursor-not-allowed'
              ]"
            >
              {{ $t('wizard.next') }}
            </button>
          </div>
        </div>

        <!-- Step 2: Choose Template -->
        <div v-else-if="currentStep === 2" class="p-6 space-y-5">
          <h2 class="text-xl font-bold text-ink">{{ $t('wizard.step2') }}</h2>
          <p class="text-sm text-ink-muted">
            {{ $t('wizard.step2Desc') }}
          </p>

          <!-- Loading -->
          <div v-if="templatesLoading" class="flex items-center justify-center py-12">
            <div class="flex items-center gap-2 text-ink-faint">
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
                'p-4 rounded-card border-2 text-left transition-all',
                selectedTemplate === tpl.id
                  ? 'border-accent-strong bg-accent-strong/10 shadow-[0_0_12px_rgba(59,130,246,0.25)]'
                  : 'border-border bg-raised/50 hover:border-border-strong hover:bg-raised'
              ]"
            >
              <div class="text-2xl mb-2">{{ iconFor(tpl.icon) }}</div>
              <div
                :class="[
                  'text-sm font-semibold mb-1 transition-colors',
                  selectedTemplate === tpl.id ? 'text-accent-ink' : 'text-ink-secondary'
                ]"
              >
                {{ tpl.name }}
              </div>
              <div class="text-xs text-ink-faint leading-relaxed">{{ tpl.description }}</div>
            </button>
          </div>

          <!-- Empty state if no templates returned -->
          <div v-if="!templatesLoading && templates.length === 0" class="text-center py-8 text-ink-faint text-sm">
            {{ $t('wizard.noTemplates') }}
          </div>

          <div class="flex justify-between pt-2">
            <button
              @click="currentStep = 1"
              class="px-5 py-2.5 rounded-control text-sm font-medium bg-raised hover:bg-overlay text-ink-secondary transition-colors"
            >
              {{ $t('wizard.back') }}
            </button>
            <button
              @click="nextStep"
              class="px-5 py-2.5 rounded-control text-sm font-medium bg-accent hover:bg-accent-hover text-white transition-colors"
            >
              {{ $t('wizard.next') }}
            </button>
          </div>
        </div>

        <!-- Step 3: Review & Create -->
        <div v-else-if="currentStep === 3" class="p-6 space-y-5">
          <h2 class="text-xl font-bold text-ink">{{ $t('wizard.step3') }}</h2>
          <p class="text-sm text-ink-muted">
            {{ $t('wizard.step3Desc') }}
          </p>

          <!-- Summary Card -->
          <div class="bg-raised/50 border border-border rounded-card p-4 space-y-3">
            <div class="flex justify-between items-baseline">
              <span class="text-sm text-ink-muted">{{ $t('wizard.summaryName') }}</span>
              <span class="text-sm font-semibold text-ink">{{ gameName }}</span>
            </div>
            <div class="flex justify-between items-baseline">
              <span class="text-sm text-ink-muted">{{ $t('wizard.summaryTemplate') }}</span>
              <span class="text-sm font-semibold text-ink">{{ selectedTemplateName }}</span>
            </div>
            <div class="flex justify-between items-baseline gap-4">
              <span class="text-sm text-ink-muted shrink-0">{{ $t('wizard.summaryDir') }}</span>
              <span class="text-sm font-semibold text-ink break-all text-right">{{ fullTargetPath }}</span>
            </div>
            <hr class="border-border-strong" />
            <div>
              <span class="text-sm text-ink-muted">{{ $t('wizard.summary') }}</span>
              <ul class="mt-2 space-y-1 text-xs text-ink-body">
                <li class="flex items-center gap-2">
                  <span class="text-accent-ink">&#x2022;</span> {{ $t('wizard.summaryConfig') }}
                </li>
                <li class="flex items-center gap-2">
                  <span class="text-accent-ink">&#x2022;</span> {{ $t('wizard.summaryDirs') }}
                </li>
                <li class="flex items-center gap-2">
                  <span class="text-accent-ink">&#x2022;</span> {{ $t('wizard.summaryAssets') }}
                </li>
              </ul>
            </div>
          </div>

          <!-- Error message -->
          <div
            v-if="createError"
            class="bg-danger-surface border border-danger-deep rounded-card p-3 text-sm text-danger-ink"
          >
            {{ createError }}
          </div>

          <!-- Success message -->
          <div
            v-if="createSuccess"
            class="bg-success-deep/30 border border-success-deep rounded-card p-3 text-sm text-success-ink flex items-center gap-2"
          >
            <span>&#10003;</span> {{ $t('wizard.created') }}
          </div>

          <!-- What's inside: friendly summary of the scaffolded files -->
          <div
            v-if="createSuccess && fileGroups.length > 0"
            class="bg-raised/50 border border-border rounded-card p-4"
          >
            <span class="text-sm text-ink-muted">{{ $t('wizard.includesTitle') }}</span>
            <ul class="mt-2 space-y-1 text-xs text-ink-body">
              <li v-for="group in fileGroups" :key="group.key" class="flex items-center gap-2">
                <span class="text-accent-ink">&#x2022;</span> {{ $t(group.key, { count: group.count }) }}
              </li>
            </ul>
          </div>

          <!-- First steps: where to go from here -->
          <div
            v-if="createSuccess"
            class="bg-raised/50 border border-border rounded-card p-4"
          >
            <span class="text-sm text-ink-muted">{{ $t('wizard.firstStepsTitle') }}</span>
            <ol class="mt-2 space-y-1 text-xs text-ink-body list-decimal list-inside">
              <li v-for="hint in firstSteps" :key="hint">{{ $t(hint) }}</li>
            </ol>
          </div>

          <div v-if="!createSuccess" class="flex justify-between pt-2">
            <button
              :disabled="creating"
              @click="currentStep = 2"
              class="px-5 py-2.5 rounded-control text-sm font-medium bg-raised hover:bg-overlay text-ink-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {{ $t('wizard.back') }}
            </button>
            <button
              :disabled="creating"
              @click="handleCreate"
              :class="[
                'px-5 py-2.5 rounded-control text-sm font-medium transition-colors flex items-center gap-2',
                creating
                  ? 'bg-raised text-ink-faint cursor-not-allowed'
                  : 'bg-accent hover:bg-accent-hover text-white cursor-pointer'
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
              class="px-5 py-2.5 rounded-control text-sm font-medium bg-accent hover:bg-accent-hover text-white transition-colors"
            >
              {{ $t('wizard.openEditor') }}
            </button>
            <button
              @click="emit('created', true)"
              class="px-5 py-2.5 rounded-control text-sm font-medium bg-ai hover:bg-ai-hover text-white transition-colors"
            >
              {{ $t('wizard.createWithAi') }}
            </button>
          </div>
        </div>
      </div>

      <!-- Manual hint -->
      <p class="text-center mt-4 text-xs text-ink-disabled">
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
