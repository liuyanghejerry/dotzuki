<template>
  <div class="h-screen relative flex flex-col bg-canvas text-ink">
    <header class="flex items-center justify-between px-5 py-3 bg-surface border-b border-border shrink-0">
      <div class="flex items-center gap-3">
        <h1 class="text-lg font-bold text-accent-ink">{{ $t('app.title') }}</h1>
        <span v-if="project.config" class="text-sm text-ink-muted">{{ project.config.name }}</span>
      </div>
      <div class="flex items-center gap-2">
        <select
          v-model="locale"
          @change="changeLocale"
          class="bg-raised text-ink-secondary text-xs rounded-control px-2 py-1 border border-border-strong"
        >
          <option value="en">English</option>
          <option value="zh">中文</option>
        </select>
        <button v-if="project.config && sidebarComponent" @click="editor.toggleSidebar()" class="px-2 py-1 text-sm rounded-control hover:bg-raised">
          {{ editor.sidebarOpen ? '◧' : '◨' }}
        </button>
        <button
          v-if="project.config"
          @click="editor.toggleAssistant()"
          :title="$t('assistant.open')"
          :class="['px-2 py-1 text-sm rounded-control', editor.assistantOpen ? 'bg-accent text-white' : 'hover:bg-raised']"
        >✨</button>
        <button
          @click="editor.toggleHelp()"
          :title="$t('help.open')"
          :class="['px-2 py-1 text-sm rounded-control', editor.helpOpen ? 'bg-accent text-white' : 'hover:bg-raised']"
        >❓</button>
      </div>
    </header>

    <div v-if="project.loading" class="flex-1 flex items-center justify-center text-ink-faint">
      {{ $t('app.loading') }}
    </div>

    <WelcomeScreen v-else-if="project.error" @created="onProjectCreated" @opened="onProjectOpened" />

    <template v-else>
      <nav class="flex bg-surface border-b border-border shrink-0 px-4">
        <button
          v-for="act in visibleActivities"
          :key="act.id"
          @click="selectActivity(act.id)"
          :class="[
            'px-5 py-2.5 text-sm border-b-2 transition-colors',
            editor.activeActivity === act.id
              ? 'border-accent-ink text-accent-ink'
              : 'border-transparent text-ink-muted hover:text-ink-secondary hover:border-border-strong'
          ]"
        >
          {{ activityIcon(act.icon) }} {{ localize(act.label) }}
        </button>
      </nav>

      <div class="flex-1 flex overflow-hidden">
        <div
          v-if="editor.sidebarOpen && sidebarComponent"
          class="w-72 bg-surface border-r border-border overflow-y-auto shrink-0"
        >
          <component :is="sidebarComponent" />
        </div>

        <main class="flex-1 overflow-auto">
          <component :is="mainComponent" v-if="mainComponent" />
          <div v-else class="flex items-center justify-center h-full text-ink-faint">
            {{ $t('app.selectActivity') }}
          </div>
        </main>

        <AssistantPanel v-show="editor.assistantOpen" />
      </div>
    </template>

    <HelpPanel v-show="editor.helpOpen" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, shallowRef } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useProjectStore } from './stores/project'
import { useEditorStore } from './stores/editor'
import { useLocalize } from './composables/useLocalize'
import WelcomeScreen from './components/WelcomeScreen.vue'
import AssistantPanel from './components/assistant/AssistantPanel.vue'
import HelpPanel from './components/help/HelpPanel.vue'

const { t, locale: i18nLocale } = useI18n()
const { localize } = useLocalize()
const router = useRouter()
const route = useRoute()
const project = useProjectStore()
const editor = useEditorStore()

/** Activities visible in the nav bar — excludes the `tiles` activity since it is
 *  now part of the Map tab (buildings/tiles are edited within the map activity). */
const visibleActivities = computed(() =>
  project.enabledActivities.filter(a => a.type !== 'tiles'),
)

const mainComponent = shallowRef<any>(null)
const sidebarComponent = shallowRef<any>(null)

const locale = ref(i18nLocale.value)
const savedLocale = localStorage.getItem('dotzuki-editor-locale')
if (savedLocale === 'zh' || savedLocale === 'en') {
  i18nLocale.value = savedLocale
  locale.value = savedLocale
}

function changeLocale() {
  i18nLocale.value = locale.value
  localStorage.setItem('dotzuki-editor-locale', locale.value)
}

function activityIcon(icon: string): string {
  const map: Record<string, string> = {
    map: '🗺', script: '📝', data: '📊', assets: '🖼',
    settings: '⚙', layout: '🎨', book: '📖', story: '📖', tiles: '🧩',
    titlescreen: '🎬', audio: '🎵', music: '🎵', play: '🎮',
  }
  return map[icon] ?? '📄'
}

function selectActivity(id: string) {
  editor.setActivity(id)
  router.push(`/edit/${id}`)
  // The component load is driven by the watch on editor.activeActivity below, so
  // programmatic switches (e.g. a quest's "jump to scene") load correctly too.
}

// Load the matching main/sidebar components whenever the active activity changes
// — from a tab click, a deep link, or a cross-activity jump.
watch(() => editor.activeActivity, (id) => { if (id) loadActivity(id) })

async function onProjectCreated(withAi?: boolean) {
  await project.loadConfig()
  const first = project.enabledActivities[0]
  if (first) {
    await selectActivity(first.id)
  }
  // "Build it with AI" — drop the user straight into the assistant panel.
  if (withAi && !editor.assistantOpen) editor.toggleAssistant()
}

async function onProjectOpened() {
  await project.loadConfig()
  const first = project.enabledActivities[0]
  if (first) {
    await selectActivity(first.id)
  }
}

async function loadActivity(id: string) {
  const act = project.getActivity(id)
  if (!act) return

  switch (act.type) {
    case 'data':
      mainComponent.value = (await import('./activities/DataActivity/DataActivity.vue')).default
      sidebarComponent.value = (await import('./activities/DataActivity/DataSidebar.vue')).default
      break
    case 'script':
      mainComponent.value = (await import('./activities/ScriptActivity/ScriptActivity.vue')).default
      sidebarComponent.value = (await import('./activities/ScriptActivity/ScriptSidebar.vue')).default
      break
    case 'map':
      mainComponent.value = (await import('./activities/MapActivity/MapActivity.vue')).default
      sidebarComponent.value = null
      break
    case 'assets':
      mainComponent.value = (await import('./activities/AssetActivity/AssetActivity.vue')).default
      sidebarComponent.value = null
      break
    case 'story':
      mainComponent.value = (await import('./activities/StoryActivity/StoryActivity.vue')).default
      sidebarComponent.value = (await import('./activities/StoryActivity/StorySidebar.vue')).default
      break
    case 'ui':
      mainComponent.value = (await import('./activities/GuiActivity/GuiActivity.vue')).default
      sidebarComponent.value = (await import('./activities/GuiActivity/GuiSidebar.vue')).default
      break
    case 'title-screen':
      mainComponent.value = (await import('./activities/TitleActivity/TitleActivity.vue')).default
      sidebarComponent.value = null
      break
    case 'settings':
      mainComponent.value = (await import('./activities/SettingsActivity/SettingsActivity.vue')).default
      sidebarComponent.value = null
      break
    case 'character-sprite':
      mainComponent.value = (await import('./activities/CharacterSpriteActivity/CharacterSpriteActivity.vue')).default
      sidebarComponent.value = null
      break
    case 'audio':
      mainComponent.value = (await import('./activities/AudioActivity/AudioActivity.vue')).default
      sidebarComponent.value = (await import('./activities/AudioActivity/AudioSidebar.vue')).default
      break
    case 'play':
      mainComponent.value = (await import('./activities/PlayActivity/PlayActivity.vue')).default
      sidebarComponent.value = null
      break
  }
}

onMounted(async () => {
  await project.loadConfig()
  const first = project.enabledActivities[0]
  if (first) {
    const urlActivity = route.params.activity as string | undefined
    const target = urlActivity && project.getActivity(urlActivity) ? urlActivity : first.id
    await selectActivity(target)
  }
})
</script>
