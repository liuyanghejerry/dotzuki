import { ref, computed, watch } from 'vue'
import type { Ref, ComputedRef } from 'vue'
import { useProjectStore } from '@/stores/project'
import type { AssetActivityConfig, ActivityDef } from '@/types'

// ─────────────────────────────────────────────────────────────────────────────
// AssetBrowser composable — file listing + navigation for the asset activity
// ─────────────────────────────────────────────────────────────────────────────

export interface AssetFile {
  name: string
  isDir: boolean
  size: number
  ext: string
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'])
const AUDIO_EXTS = new Set(['.mp3', '.ogg', '.wav', '.flac', '.m4a'])
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov'])

export function useAssetBrowser() {
  const project = useProjectStore()

  // ── config derivation ────────────────────────────────────────────────────
  const config: ComputedRef<AssetActivityConfig | null> = computed(() => {
    const act = project.config?.activities.find((a: ActivityDef) => a.type === 'assets')
    return (act?.config as AssetActivityConfig) ?? null
  })

  const roots = computed(() => config.value?.roots ?? [])
  const extensions = computed(() => config.value?.extensions ?? [])

  // ── state ────────────────────────────────────────────────────────────────
  const activeRoot: Ref<string> = ref('')
  const files: Ref<AssetFile[]> = ref([])
  const loading: Ref<boolean> = ref(false)
  const error: Ref<string | null> = ref(null)
  const viewMode: Ref<'grid' | 'list'> = ref('grid')
  const currentPath: Ref<string> = ref('')
  const selectedFile: Ref<AssetFile | null> = ref(null)

  // ── computed ─────────────────────────────────────────────────────────────
  /** Breadcrumb segments for the current path */
  const breadcrumbs = computed(() => {
    if (!currentPath.value) return []
    return currentPath.value.split('/').filter(Boolean)
  })

  /** Breadcrumb path at each level for navigation */
  function breadcrumbPath(index: number): string {
    return breadcrumbs.value.slice(0, index + 1).join('/')
  }

  /** Files sorted (dirs first, then alpha) and optionally filtered by ext */
  const displayFiles = computed(() => {
    let result = files.value
    if (extensions.value.length > 0) {
      result = result.filter((f: AssetFile) => f.isDir || extensions.value.includes(f.ext.toLowerCase()))
    }
    return [...result].sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  })

  // ── API helpers ──────────────────────────────────────────────────────────
  function listUrl(): string {
    const params = new URLSearchParams()
    params.set('root', activeRoot.value)
    if (currentPath.value) params.set('path', currentPath.value)
    return `/api/assets/list?${params.toString()}`
  }

  /** URL to download/view a specific asset file */
  function fileUrl(file: AssetFile): string {
    const fp = filePath(file)
    return `/api/assets/file?root=${encodeURIComponent(activeRoot.value)}&path=${encodeURIComponent(fp)}`
  }

  /** Relative path of a file from the active root */
  function filePath(file: AssetFile): string {
    return currentPath.value ? `${currentPath.value}/${file.name}` : file.name
  }

  /** Whether a file is a recognised image type */
  function isImage(file: AssetFile): boolean {
    return IMAGE_EXTS.has(file.ext.toLowerCase())
  }

  /** Whether a file is a recognised audio type (previewable via <audio>). */
  function isAudio(file: AssetFile): boolean {
    return AUDIO_EXTS.has(file.ext.toLowerCase())
  }

  /** Whether a file is a recognised video type (previewable via <video>). */
  function isVideo(file: AssetFile): boolean {
    return VIDEO_EXTS.has(file.ext.toLowerCase())
  }

  /** Human-readable file size */
  function formatSize(bytes: number): string {
    if (bytes === 0) return '—'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  // ── file fetching ────────────────────────────────────────────────────────
  async function fetchFiles(): Promise<void> {
    if (!activeRoot.value) return
    loading.value = true
    error.value = null
    try {
      const resp = await fetch(listUrl())
      if (!resp.ok) {
        const msg = await resp.json().then(j => j.error).catch(() => 'Unknown error')
        throw new Error(msg)
      }
      files.value = await resp.json()
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to list assets'
      files.value = []
    } finally {
      loading.value = false
    }
  }

  // ── mutations (upload / rename / delete / mkdir) ───────────────────────────
  /** Relative path (from the active root) for a child of the current dir. */
  function childPath(name: string): string {
    return currentPath.value ? `${currentPath.value}/${name}` : name
  }

  /** Upload one or more files into the current directory, then refresh. */
  async function uploadFiles(fileList: FileList | File[]): Promise<void> {
    error.value = null
    try {
      for (const file of Array.from(fileList)) {
        const dest = childPath(file.name)
        const resp = await fetch(`/api/assets/upload?root=${encodeURIComponent(activeRoot.value)}&path=${encodeURIComponent(dest)}`, {
          method: 'POST', body: file,
        })
        if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || `Upload failed: ${file.name}`)
      }
      await fetchFiles()
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Upload failed'
    }
  }

  /** Delete a file/dir, then refresh. */
  async function deleteFile(file: AssetFile): Promise<void> {
    error.value = null
    try {
      const resp = await fetch(`/api/assets/delete?root=${encodeURIComponent(activeRoot.value)}&path=${encodeURIComponent(filePath(file))}`, { method: 'DELETE' })
      if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || 'Delete failed')
      if (selectedFile.value?.name === file.name) selectedFile.value = null
      await fetchFiles()
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Delete failed'
    }
  }

  /** Rename a file/dir within the current directory, then refresh. */
  async function renameFile(file: AssetFile, newName: string): Promise<void> {
    error.value = null
    if (!newName || newName === file.name) return
    try {
      const resp = await fetch('/api/assets/rename', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root: activeRoot.value, from: filePath(file), to: childPath(newName) }),
      })
      if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || 'Rename failed')
      await fetchFiles()
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Rename failed'
    }
  }

  /** Create a subdirectory in the current directory, then refresh. */
  async function createFolder(name: string): Promise<void> {
    error.value = null
    if (!name) return
    try {
      const resp = await fetch('/api/assets/mkdir', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root: activeRoot.value, path: childPath(name) }),
      })
      if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || 'Create folder failed')
      await fetchFiles()
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Create folder failed'
    }
  }

  // ── navigation ───────────────────────────────────────────────────────────
  function setRoot(root: string): void {
    if (activeRoot.value === root) return
    activeRoot.value = root
    currentPath.value = ''
    selectedFile.value = null
    fetchFiles()
  }

  function navigateTo(dir: string): void {
    currentPath.value = currentPath.value
      ? `${currentPath.value}/${dir}`
      : dir
    selectedFile.value = null
    fetchFiles()
  }

  function navigateUp(): void {
    const parts = breadcrumbs.value
    if (parts.length === 0) return
    parts.pop()
    currentPath.value = parts.join('/')
    selectedFile.value = null
    fetchFiles()
  }

  function navigateToBreadcrumb(index: number): void {
    const parts = breadcrumbs.value
    currentPath.value = parts.slice(0, index + 1).join('/')
    selectedFile.value = null
    fetchFiles()
  }

  function selectFile(file: AssetFile): void {
    if (file.isDir) {
      navigateTo(file.name)
    } else {
      selectedFile.value = selectedFile.value?.name === file.name ? null : file
    }
  }

  // ── auto-fetch on root change ────────────────────────────────────────────
  watch(activeRoot, () => {
    if (activeRoot.value) fetchFiles()
  })

  return {
    // config
    config,
    roots,
    extensions,
    // state
    activeRoot,
    files,
    loading,
    error,
    viewMode,
    currentPath,
    selectedFile,
    // computed
    breadcrumbs,
    displayFiles,
    // helpers
    breadcrumbPath,
    fileUrl,
    filePath,
    isImage,
    isAudio,
    isVideo,
    formatSize,
    // actions
    fetchFiles,
    setRoot,
    navigateTo,
    navigateUp,
    navigateToBreadcrumb,
    selectFile,
    // mutations
    uploadFiles,
    deleteFile,
    renameFile,
    createFolder,
  }
}
