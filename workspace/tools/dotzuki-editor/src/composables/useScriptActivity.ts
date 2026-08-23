import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface ScriptFile {
  name: string
  isDir: boolean
  size: number
  path: string
}

export const useScriptActivity = defineStore('scriptActivity', () => {
  const files = ref<ScriptFile[]>([])
  const activeFile = ref<string>('')
  /** A file (relative path) to open on next mount — set by cross-activity jumps. */
  const pendingFile = ref<string>('')
  const content = ref<string>('')
  const originalContent = ref<string>('')
  const loading = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)

  let _extension = '.js'

  const dirty = computed(() => content.value !== originalContent.value)

  const activeFileName = computed(() => {
    if (!activeFile.value) return ''
    const lastSlash = activeFile.value.lastIndexOf('/')
    return lastSlash >= 0 ? activeFile.value.slice(lastSlash + 1) : activeFile.value
  })

  function configure(_scriptsDir: string, extension: string) {
    // scriptsDir is applied server-side (see apiUrl); only the extension is
    // needed client-side, to filter the listing.
    _extension = extension
  }

  function apiUrl(subPath: string): string {
    // The dev server prepends the activity's scriptsDir, so the URL carries only
    // the path RELATIVE to it (mirrors /api/maps). Including scriptsDir here too
    // double-prefixes it on the server → resolves to a missing dir → "File not found".
    return `api/scripts/${subPath}`.replace(/\/+/g, '/')
  }

  async function fetchFiles(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const resp = await fetch(apiUrl(''))
      if (!resp.ok) {
        const msg = await resp.json().then(j => j.error).catch(() => 'Unknown error')
        throw new Error(msg)
      }
      const raw = await resp.json() as ScriptFile[]
      files.value = raw.filter(f => !f.isDir && f.name.endsWith(_extension))
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to list scripts'
      files.value = []
    } finally {
      loading.value = false
    }
  }

  async function loadFile(path: string): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const resp = await fetch(apiUrl(path))
      if (!resp.ok) {
        const msg = await resp.json().then(j => j.error).catch(() => 'Unknown error')
        throw new Error(msg)
      }
      const text = await resp.text()
      activeFile.value = path
      originalContent.value = text
      content.value = text
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load script'
    } finally {
      loading.value = false
    }
  }

  async function saveFile(path: string, body: string): Promise<void> {
    saving.value = true
    error.value = null
    try {
      const resp = await fetch(apiUrl(path), {
        method: 'PUT',
        headers: { 'Content-Type': 'text/plain' },
        body,
      })
      if (!resp.ok) {
        const msg = await resp.json().then(j => j.error).catch(() => 'Unknown error')
        throw new Error(msg)
      }
      originalContent.value = body
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to save script'
    } finally {
      saving.value = false
    }
  }

  return {
    files,
    activeFile,
    pendingFile,
    activeFileName,
    content,
    originalContent,
    dirty,
    loading,
    saving,
    error,
    configure,
    fetchFiles,
    loadFile,
    saveFile,
  }
})
