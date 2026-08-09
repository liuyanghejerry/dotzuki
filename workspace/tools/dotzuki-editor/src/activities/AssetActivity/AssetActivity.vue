<template>
  <div class="h-full flex flex-col bg-gray-900">
    <!-- ── No config ── -->
    <div
      v-if="!browser.config.value"
      class="flex-1 flex items-center justify-center text-gray-500 text-sm"
    >
      <i18n-t keypath="assets.noConfig" tag="span">
        <template #assets><code class="bg-gray-800 px-1 rounded">assets</code></template>
        <template #file><code class="bg-gray-800 px-1 rounded">.dotzuki-editor.json</code></template>
      </i18n-t>
    </div>

    <template v-else>
      <!-- ── Root tabs ── -->
      <nav class="flex bg-gray-800 border-b border-gray-700 shrink-0 px-2">
        <button
          v-for="root in browser.roots.value"
          :key="root"
          @click="browser.setRoot(root)"
          :class="[
            'px-4 py-2 text-sm border-b-2 transition-colors truncate max-w-[240px]',
            root === browser.activeRoot.value
              ? 'border-blue-400 text-blue-400'
              : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-600',
          ]"
        >
          {{ rootLabel(root) }}
        </button>
      </nav>

      <!-- ── Toolbar: breadcrumbs + view toggle ── -->
      <div
        v-if="browser.activeRoot.value"
        class="flex items-center justify-between px-3 py-2 bg-gray-850 border-b border-gray-700 shrink-0"
      >
        <div class="flex items-center gap-1 text-sm min-w-0">
          <button
            class="shrink-0 px-1.5 py-0.5 rounded text-blue-400 hover:bg-gray-700 transition-colors"
            :class="{ 'opacity-30 cursor-default': browser.breadcrumbs.value.length === 0 }"
            @click="browser.navigateUp()"
          >
            {{ browser.activeRoot.value }}
          </button>

          <template v-for="(crumb, i) in browser.breadcrumbs.value" :key="i">
            <span class="text-gray-600 shrink-0">/</span>
            <button
              class="shrink-0 px-1.5 py-0.5 rounded hover:bg-gray-700 transition-colors truncate max-w-[160px]"
              :class="i === browser.breadcrumbs.value.length - 1 ? 'text-gray-200' : 'text-gray-400'"
              @click="browser.navigateToBreadcrumb(i)"
            >
              {{ crumb }}
            </button>
          </template>

          <span v-if="browser.loading.value" class="ml-2 shrink-0">
            <span class="inline-block w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          </span>
        </div>

        <div class="flex items-center gap-1 shrink-0">
          <!-- ── Mutations: upload / new folder / rename / delete ── -->
          <button
            @click="triggerUpload"
            class="px-2 py-1 rounded text-xs text-gray-300 hover:bg-gray-700 transition-colors"
            :title="$t('assets.upload')"
          >
            ⬆ {{ $t('assets.upload') }}
          </button>
          <button
            @click="onNewFolder"
            class="px-2 py-1 rounded text-xs text-gray-300 hover:bg-gray-700 transition-colors"
            :title="$t('assets.newFolder')"
          >
            ＋📁
          </button>
          <button
            v-if="browser.selectedFile.value"
            @click="onRenameSelected"
            class="px-2 py-1 rounded text-xs text-gray-300 hover:bg-gray-700 transition-colors"
            :title="$t('assets.rename')"
          >
            ✎
          </button>
          <button
            v-if="browser.selectedFile.value"
            @click="onDeleteSelected"
            class="px-2 py-1 rounded text-xs text-red-400 hover:bg-red-900/40 transition-colors"
            :title="$t('assets.delete')"
          >
            🗑
          </button>
          <input ref="fileInput" type="file" multiple class="hidden" @change="onFilesPicked" />
          <span class="w-px h-4 bg-gray-700 mx-1" />
          <button
            @click="browser.viewMode.value = 'grid'"
            class="px-2 py-1 rounded text-xs transition-colors"
            :class="browser.viewMode.value === 'grid' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-700'"
            :title="$t('assets.grid')"
          >
            ▦
          </button>
          <button
            @click="browser.viewMode.value = 'list'"
            class="px-2 py-1 rounded text-xs transition-colors"
            :class="browser.viewMode.value === 'list' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-700'"
            :title="$t('assets.list')"
          >
            ☰
          </button>
        </div>
      </div>

      <!-- ── Status bar: file count ── -->
      <div
        v-if="browser.activeRoot.value && !browser.loading.value && !browser.error.value"
        class="px-3 py-1 bg-gray-850 border-b border-gray-700/50 text-xs text-gray-500 shrink-0"
      >
        {{ browser.displayFiles.value.length }} {{ browser.displayFiles.value.length === 1 ? $t('assets.item') : $t('assets.items') }}
        <span v-if="browser.extensions.value.length" class="ml-2">
          · {{ $t('assets.filtered') }}: {{ browser.extensions.value.join(', ') }}
        </span>
      </div>

      <!-- ── Main content ── -->
      <div class="flex-1 overflow-hidden flex">
        <div class="flex-1 overflow-auto">
          <!-- Error -->
          <div
            v-if="browser.error.value"
            class="flex items-center justify-center h-full"
          >
            <div class="text-center">
              <p class="text-red-400 mb-1">{{ browser.error.value }}</p>
              <button
                @click="browser.fetchFiles()"
                class="text-sm text-blue-400 hover:text-blue-300"
              >
                {{ $t('common.retry') }}
              </button>
            </div>
          </div>

          <!-- Loading skeleton -->
          <div
            v-else-if="browser.loading.value"
            class="p-6"
          >
            <div v-if="browser.viewMode.value === 'grid'" class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              <div v-for="n in 12" :key="n" class="aspect-square bg-gray-800 rounded-lg animate-pulse" />
            </div>
            <div v-else class="space-y-1">
              <div v-for="n in 8" :key="n" class="h-8 bg-gray-800 rounded animate-pulse" />
            </div>
          </div>

          <!-- Empty -->
          <div
            v-else-if="browser.displayFiles.value.length === 0"
            class="flex items-center justify-center h-full"
          >
            <div class="text-center text-gray-500">
              <p class="text-4xl mb-3">📁</p>
              <p class="text-sm">{{ $t('assets.noFiles') }}</p>
              <p v-if="browser.extensions.value.length" class="text-xs text-gray-600 mt-1">
                {{ $t('assets.extFilter') }}: {{ browser.extensions.value.join(', ') }}
              </p>
            </div>
          </div>

          <!-- Grid view -->
          <div
            v-else-if="browser.viewMode.value === 'grid'"
            class="p-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3"
          >
            <button
              v-for="file in browser.displayFiles.value"
              :key="file.name"
              @click="browser.selectFile(file)"
              :class="[
                'group relative flex flex-col items-center rounded-lg border transition-all duration-150',
                file === browser.selectedFile.value
                  ? 'border-blue-400 bg-blue-900/20 ring-1 ring-blue-400/30'
                  : 'border-gray-700 bg-gray-800/60 hover:bg-gray-700/60 hover:border-gray-600',
              ]"
            >
              <!-- Thumbnail area -->
              <div class="w-full aspect-square flex items-center justify-center p-2 overflow-hidden">
                <span v-if="file.isDir" class="text-3xl">📁</span>

                <img
                  v-else-if="browser.isImage(file)"
                  :src="browser.fileUrl(file)"
                  :alt="file.name"
                  loading="lazy"
                  class="max-w-full max-h-full object-contain rounded"
                  @error="onImageError"
                />

                <span v-else class="text-3xl">{{ fileIcon(file) }}</span>
              </div>

              <!-- Label -->
              <div class="w-full px-2 pb-2 min-w-0">
                <p
                  class="text-xs text-center truncate"
                  :class="file === browser.selectedFile.value ? 'text-blue-300' : 'text-gray-400 group-hover:text-gray-200'"
                >
                  {{ file.name }}
                </p>
              </div>

              <!-- Image overlay on hover — view hint -->
              <div
                v-if="!file.isDir && browser.isImage(file)"
                class="absolute inset-0 flex items-end justify-center pb-6 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-lg pointer-events-none"
              >
                <span class="text-xs text-white bg-black/50 px-2 py-0.5 rounded">{{ $t('assets.clickPreview') }}</span>
              </div>
            </button>
          </div>

          <!-- List view -->
          <div v-else class="overflow-auto">
            <table class="w-full text-sm">
              <thead class="sticky top-0 bg-gray-850">
                <tr class="text-left text-gray-500 text-xs uppercase tracking-wider">
                  <th class="px-4 py-2 w-8" />
                  <th class="px-0 py-2 font-medium">{{ $t('assets.colName') }}</th>
                  <th class="px-4 py-2 font-medium hidden md:table-cell">{{ $t('assets.colType') }}</th>
                  <th class="px-4 py-2 font-medium hidden sm:table-cell text-right">{{ $t('assets.colSize') }}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-700/50">
                <tr
                  v-for="file in browser.displayFiles.value"
                  :key="file.name"
                  @click="browser.selectFile(file)"
                  :class="[
                    'cursor-pointer transition-colors',
                    file === browser.selectedFile.value
                      ? 'bg-blue-900/20'
                      : 'hover:bg-gray-800/50',
                  ]"
                >
                  <td class="px-4 py-2 text-lg">
                    {{ file.isDir ? '📁' : fileIcon(file) }}
                  </td>
                  <td class="px-0 py-2 truncate max-w-[300px]">
                    <span :class="file === browser.selectedFile.value ? 'text-blue-300' : 'text-gray-200'">
                      {{ file.name }}
                    </span>
                  </td>
                  <td class="px-4 py-2 text-gray-500 hidden md:table-cell">
                    {{ file.isDir ? $t('assets.folder') : file.ext || $t('common.dash') }}
                  </td>
                  <td class="px-4 py-2 text-gray-500 text-right hidden sm:table-cell tabular-nums">
                    {{ file.isDir ? '—' : browser.formatSize(file.size) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- ── Preview panel (selected image / audio / video) ── -->
        <div
          v-if="previewKind"
          class="w-80 border-l border-gray-700 bg-gray-800 flex flex-col shrink-0"
        >
          <div class="flex items-center justify-between px-3 py-2 border-b border-gray-700 shrink-0">
            <span class="text-sm text-gray-300 truncate">{{ browser.selectedFile.value?.name }}</span>
            <button
              @click="browser.selectedFile.value = null"
              class="text-gray-500 hover:text-gray-300 text-lg leading-none px-1"
            >
              &times;
            </button>
          </div>

          <div class="flex-1 flex items-center justify-center p-4 bg-gray-900/50 overflow-auto">
            <img
              v-if="previewKind === 'image'"
              :src="selectedUrl!"
              :alt="browser.selectedFile.value?.name"
              class="max-w-full max-h-full object-contain rounded"
            />
            <video
              v-else-if="previewKind === 'video'"
              :src="selectedUrl!"
              controls
              class="max-w-full max-h-full rounded"
            />
            <audio
              v-else-if="previewKind === 'audio'"
              :src="selectedUrl!"
              controls
              class="w-full"
            />
          </div>

          <div class="px-3 py-2 border-t border-gray-700 text-xs text-gray-500 space-y-1 shrink-0">
            <p><span class="text-gray-600">{{ $t('assets.propName') }}:</span> {{ browser.selectedFile.value?.name }}</p>
            <p><span class="text-gray-600">{{ $t('assets.propSize') }}:</span> {{ browser.formatSize(browser.selectedFile.value?.size ?? 0) }}</p>
            <p><span class="text-gray-600">{{ $t('assets.propType') }}:</span> {{ browser.selectedFile.value?.ext || $t('common.unknown') }}</p>
            <p class="truncate"><span class="text-gray-600">{{ $t('assets.propPath') }}:</span> {{ browser.activeRoot.value }}/{{ browser.filePath(browser.selectedFile.value!) }}</p>
            <a
              :href="selectedUrl!"
              target="_blank"
              class="inline-block mt-2 px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs transition-colors"
            >
              {{ $t('assets.openFull') }}
            </a>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAssetBrowser } from '@/composables/useAssetBrowser'

const { t } = useI18n()
import type { AssetFile } from '@/composables/useAssetBrowser'

const browser = useAssetBrowser()
const fileInput = ref<HTMLInputElement | null>(null)

/** Preview URL for the selected image file (kept for the existing image markup). */
const selectedPreview = computed(() => {
  const file = browser.selectedFile.value
  if (!file || file.isDir || !browser.isImage(file)) return null
  return browser.fileUrl(file)
})

/** What kind of inline preview the selected file supports. */
const previewKind = computed<'image' | 'audio' | 'video' | null>(() => {
  const f = browser.selectedFile.value
  if (!f || f.isDir) return null
  if (browser.isImage(f)) return 'image'
  if (browser.isAudio(f)) return 'audio'
  if (browser.isVideo(f)) return 'video'
  return null
})

/** Source URL for any previewable selected file. */
const selectedUrl = computed(() => {
  const f = browser.selectedFile.value
  return f && !f.isDir ? browser.fileUrl(f) : null
})

// ── mutations ────────────────────────────────────────────────────────────────
function triggerUpload() { fileInput.value?.click() }

async function onFilesPicked(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files?.length) await browser.uploadFiles(input.files)
  input.value = '' // allow re-picking the same file
}

async function onNewFolder() {
  const name = window.prompt(t('assets.newFolderPrompt'))
  if (name) await browser.createFolder(name.trim())
}

async function onDeleteSelected() {
  const f = browser.selectedFile.value
  if (f && window.confirm(t('assets.deleteConfirm', { name: f.name }))) await browser.deleteFile(f)
}

async function onRenameSelected() {
  const f = browser.selectedFile.value
  if (!f) return
  const name = window.prompt(t('assets.renamePrompt'), f.name)
  if (name && name.trim() !== f.name) await browser.renameFile(f, name.trim())
}

/** Extract the last segment of a root path for display */
function rootLabel(root: string): string {
  const parts = root.replace(/\/$/, '').split('/')
  return parts[parts.length - 1] || root
}

/** Return an emoji icon for a file based on its extension */
function fileIcon(file: AssetFile): string {
  const ext = file.ext.toLowerCase()
  const iconMap: Record<string, string> = {
    '.json': '📋',
    '.js': '📜',
    '.ts': '📘',
    '.asm': '⚙',
    '.txt': '📄',
    '.md': '📝',
    '.csv': '📊',
    '.xml': '📰',
    '.yaml': '📋',
    '.yml': '📋',
    '.toml': '⚙',
    '.lock': '🔒',
    '.zip': '📦',
    '.gz': '📦',
    '.tar': '📦',
    '.mp3': '🎵',
    '.wav': '🎵',
    '.ogg': '🎵',
    '.mp4': '🎬',
    '.pdf': '📕',
  }
  return iconMap[ext] ?? '📄'
}

/** Handle broken image thumbnails — swap to a generic file icon */
function onImageError(e: Event) {
  const el = e.target as HTMLImageElement
  el.style.display = 'none'
  const placeholder = document.createElement('span')
  placeholder.className = 'text-3xl'
  placeholder.textContent = '🖼'
  el.parentElement?.appendChild(placeholder)
}
</script>

<style scoped>
.bg-gray-850 {
  background-color: #1a1e2b;
}
</style>
