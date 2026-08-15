<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStoryActivity } from '@/composables/useStoryActivity'
import { useEditorStore } from '@/stores/editor'
import { useProjectStore } from '@/stores/project'
import { useScriptActivity } from '@/composables/useScriptActivity'
import LocalizedField from './LocalizedField.vue'
import StringList from './StringList.vue'
import SceneGenerator from './SceneGenerator.vue'

const { t } = useI18n()
const story = useStoryActivity()
const { selectedRecord, locales, flags, saving, scenes } = story
const editorStore = useEditorStore()
const projectStore = useProjectStore()
const scriptStore = useScriptActivity()

const statuses = ['idea', 'drafted', 'scripted', 'done']
const types = ['main', 'side', 'fetch', 'battle', 'event']

// ── implementedBy ⇄ .scene linking ──────────────────────────────────────
const sceneStems = computed(() => scenes.value.map((s: any) => s.stem))
const stemSet = computed(() => new Set(sceneStems.value))
function namesFor(stem: string): string[] {
  return scenes.value.find((s: any) => s.stem === stem)?.names ?? []
}
/** Empty = not yet filled (no warning); a non-empty stem must match a real scene. */
function sceneExists(stem: string): boolean {
  return !stem || stemSet.value.has(stem)
}
const implHasMissing = computed(() =>
  (selectedRecord.value?.implementedBy ?? []).some((im: any) => im.scene && !stemSet.value.has(im.scene)),
)
const scriptActivity = computed(() => projectStore.enabledActivities.find((a: any) => a.type === 'script'))
/** Jump to the Scenes activity and open this scene's file (by its real path). */
function openScene(stem: string) {
  if (!stem || !scriptActivity.value) return
  const sc = scenes.value.find((s: any) => s.stem === stem)
  if (!sc) return
  scriptStore.pendingFile = sc.path
  editorStore.setActivity(scriptActivity.value.id)
}
/** When a scene is chosen, default the storyline to its sole game_scene name. */
function onSceneChange(im: any) {
  const names = namesFor(im.scene)
  if (names.length && !im.storyline) im.storyline = names[0]
}

function addObjective() {
  selectedRecord.value.objectives.push({ id: 'o' + (selectedRecord.value.objectives.length + 1), text: story.emptyLocalized(), doneFlag: '' })
}
function delObjective(i: number) { selectedRecord.value.objectives.splice(i, 1) }
function addReward() { selectedRecord.value.rewards.push({ kind: 'item', id: '', amount: 1 }) }
function delReward(i: number) { selectedRecord.value.rewards.splice(i, 1) }
function addImpl() { selectedRecord.value.implementedBy.push({ scene: '', storyline: '' }) }
function delImpl(i: number) { selectedRecord.value.implementedBy.splice(i, 1) }

function onSave() { story.save('quests', selectedRecord.value) }
function onDelete() {
  if (confirm(t('story.confirmDelete'))) story.remove('quests', selectedRecord.value.id)
}
</script>

<template>
  <div v-if="selectedRecord" class="h-full overflow-y-auto p-5 max-w-3xl">
    <div class="flex items-center gap-3 mb-4">
      <input v-model="selectedRecord.id" placeholder="quest-id" class="bg-surface border border-border rounded-control px-2 py-1 text-sm text-accent-ink-strong font-mono w-48" />
      <select v-model="selectedRecord.type" class="bg-surface border border-border rounded-control px-2 py-1 text-xs text-ink-secondary">
        <option v-for="ty in types" :key="ty" :value="ty">{{ t('story.questType.' + ty) }}</option>
      </select>
      <select v-model="selectedRecord.status" class="bg-surface border border-border rounded-control px-2 py-1 text-xs text-ink-secondary">
        <option v-for="s in statuses" :key="s" :value="s">{{ t('story.status.' + s) }}</option>
      </select>
      <div class="flex-1" />
      <button @click="onDelete" class="px-2 py-1 text-xs rounded-control text-ink-muted hover:text-danger-ink">{{ t('story.delete') }}</button>
      <button @click="onSave" :disabled="saving" class="px-4 py-1 text-xs rounded-control bg-accent text-white hover:bg-accent-strong disabled:opacity-40">
        {{ saving ? t('story.saving') : t('story.save') }}
      </button>
    </div>

    <div class="grid grid-cols-2 gap-4 mb-4">
      <LocalizedField :label="t('story.fields.title')" :locales="locales" v-model="selectedRecord.title" />
      <div class="space-y-3">
        <label class="block text-tiny uppercase tracking-wide text-ink-faint">{{ t('story.fields.arc') }}
          <select v-model="selectedRecord.arc" class="mt-1 w-full bg-surface border border-border rounded-control px-2 py-1 text-sm text-ink">
            <option value="">—</option>
            <option v-for="a in story.arcs.value" :key="a.id" :value="a.id">{{ a.id }}</option>
          </select>
        </label>
        <label class="block text-tiny uppercase tracking-wide text-ink-faint">{{ t('story.fields.giver') }}
          <select v-model="selectedRecord.giver" class="mt-1 w-full bg-surface border border-border rounded-control px-2 py-1 text-sm text-ink">
            <option value="">—</option>
            <option v-for="c in story.characters.value" :key="c.id" :value="c.id">{{ c.id }}</option>
          </select>
        </label>
      </div>
    </div>

    <label class="block text-tiny uppercase tracking-wide text-ink-faint mb-4">{{ t('story.fields.summary') }}
      <textarea v-model="selectedRecord.summary" rows="2" class="mt-1 w-full bg-surface border border-border rounded-control px-2 py-1 text-sm text-ink focus:border-accent-strong focus:outline-none" />
    </label>

    <div class="grid grid-cols-2 gap-4 mb-4">
      <StringList :label="t('story.fields.characters')" v-model="selectedRecord.characters" :options="story.characters.value.map((c:any)=>c.id)" :placeholder="t('story.addCharacter')" />
      <StringList :label="t('story.fields.maps')" v-model="selectedRecord.maps" :placeholder="t('story.addMap')" />
    </div>

    <!-- Flag bridge to the engine -->
    <div class="grid grid-cols-2 gap-4 mb-5">
      <StringList :label="t('story.fields.requires')" v-model="selectedRecord.requires" :options="flags" placeholder="EVENT_..." />
      <StringList :label="t('story.fields.sets')" v-model="selectedRecord.sets" :options="flags" placeholder="EVENT_..." />
    </div>

    <!-- objectives -->
    <div class="mb-5">
      <div class="flex items-center justify-between mb-1">
        <label class="text-tiny uppercase tracking-wide text-ink-faint">{{ t('story.fields.objectives') }}</label>
        <button @click="addObjective" class="text-tiny text-accent-ink hover:text-accent-ink-strong">＋ {{ t('story.add') }}</button>
      </div>
      <div v-for="(o, i) in selectedRecord.objectives" :key="i" class="bg-surface/40 border border-border/60 rounded-control p-2 mb-2">
        <div class="flex gap-2 mb-2">
          <input v-model="o.id" placeholder="o1" class="w-16 bg-surface border border-border rounded-control px-2 py-1 text-xs text-ink" />
          <input v-model="o.doneFlag" list="quest-flags" placeholder="doneFlag (EVENT_...)" class="flex-1 bg-surface border border-border rounded-control px-2 py-1 text-xs text-ink" />
          <button @click="delObjective(Number(i))" class="text-ink-faint hover:text-danger-ink px-1">×</button>
        </div>
        <LocalizedField :label="t('story.fields.text')" :locales="locales" v-model="o.text" />
      </div>
      <datalist id="quest-flags"><option v-for="f in flags" :key="f" :value="f" /></datalist>
    </div>

    <!-- rewards -->
    <div class="mb-5">
      <div class="flex items-center justify-between mb-1">
        <label class="text-tiny uppercase tracking-wide text-ink-faint">{{ t('story.fields.rewards') }}</label>
        <button @click="addReward" class="text-tiny text-accent-ink hover:text-accent-ink-strong">＋ {{ t('story.add') }}</button>
      </div>
      <div v-for="(r, i) in selectedRecord.rewards" :key="i" class="flex gap-2 mb-1">
        <input v-model="r.kind" placeholder="item" class="w-28 bg-surface border border-border rounded-control px-2 py-1 text-xs text-ink" />
        <input v-model="r.id" placeholder="POTION" class="flex-1 bg-surface border border-border rounded-control px-2 py-1 text-xs text-ink" />
        <input v-model.number="r.amount" type="number" class="w-20 bg-surface border border-border rounded-control px-2 py-1 text-xs text-ink" />
        <button @click="delReward(Number(i))" class="text-ink-faint hover:text-danger-ink px-1">×</button>
      </div>
    </div>

    <!-- implementation cross-reference -->
    <div class="mb-2">
      <div class="flex items-center justify-between mb-1">
        <label class="text-tiny uppercase tracking-wide text-ink-faint">{{ t('story.fields.implementedBy') }}</label>
        <button @click="addImpl" class="text-tiny text-accent-ink hover:text-accent-ink-strong">＋ {{ t('story.add') }}</button>
      </div>
      <div v-for="(im, i) in selectedRecord.implementedBy" :key="i" class="flex gap-2 mb-1 items-center">
        <input v-model="im.scene" @change="onSceneChange(im)" list="quest-scene-stems" :placeholder="t('story.scenePlaceholder')"
          class="flex-1 bg-surface border rounded-control px-2 py-1 text-xs text-ink focus:outline-none"
          :class="sceneExists(im.scene) ? 'border-border focus:border-accent-strong' : 'border-warning/70'" />
        <input v-model="im.storyline" :list="'quest-sl-' + i" :placeholder="t('story.storylinePlaceholder')"
          class="flex-1 bg-surface border border-border rounded-control px-2 py-1 text-xs text-ink focus:outline-none focus:border-accent-strong" />
        <datalist :id="'quest-sl-' + i"><option v-for="n in namesFor(im.scene)" :key="n" :value="n" /></datalist>
        <button v-if="scriptActivity && im.scene && sceneExists(im.scene)" type="button" @click="openScene(im.scene)"
          class="text-ink-muted hover:text-accent-ink-strong px-1" :title="t('story.openScene')">↗</button>
        <button type="button" @click="delImpl(Number(i))" class="text-ink-faint hover:text-danger-ink px-1">×</button>
      </div>
      <datalist id="quest-scene-stems"><option v-for="s in sceneStems" :key="s" :value="s" /></datalist>
      <p v-if="!selectedRecord.implementedBy.length" class="text-tiny text-warning/80">{{ t('story.noImplementation') }}</p>
      <p v-else-if="implHasMissing" class="text-tiny text-warning/80 mt-1">⚠ {{ t('story.sceneMissing') }}</p>
    </div>

    <!-- 剧情 → .scene generation -->
    <SceneGenerator :key="selectedRecord.id" />
  </div>

  <div v-else class="h-full flex items-center justify-center text-ink-disabled text-sm">
    {{ t('story.selectOrCreate') }}
  </div>
</template>
