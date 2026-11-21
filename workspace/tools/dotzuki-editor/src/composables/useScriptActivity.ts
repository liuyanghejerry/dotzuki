import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface ScriptFile {
  name: string
  isDir: boolean
  size: number
  path: string
  displayPath: string
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

  let loadId = 0

  const dirty = computed(() => content.value !== originalContent.value)

  const activeFileName = computed(() => {
    if (!activeFile.value) return ''
    const lastSlash = activeFile.value.lastIndexOf('/')
    return lastSlash >= 0 ? activeFile.value.slice(lastSlash + 1) : activeFile.value
  })

  function apiUrl(file?: string): string {
    const params = new URLSearchParams({ scope: 'project' })
    if (file) params.set('file', file)
    return 'api/scripts?' + params
  }

  async function fetchFiles(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const resp = await fetch(apiUrl())
      if (!resp.ok) {
        const msg = await resp.json().then(j => j.error).catch(() => 'Unknown error')
        throw new Error(msg)
      }
      const raw = await resp.json() as ScriptFile[]
      files.value = raw.filter(f => !f.isDir)
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to list scripts'
      files.value = []
    } finally {
      loading.value = false
    }
  }

  async function loadFile(path: string): Promise<void> {
    const request = ++loadId
    loading.value = true
    error.value = null
    try {
      const resp = await fetch(apiUrl(path))
      if (!resp.ok) {
        const msg = await resp.json().then(j => j.error).catch(() => 'Unknown error')
        throw new Error(msg)
      }
      const text = await resp.text()
      if (request !== loadId) return
      activeFile.value = path
      originalContent.value = text
      content.value = text
    } catch (e) {
      if (request !== loadId) return
      error.value = e instanceof Error ? e.message : 'Failed to load script'
    } finally {
      if (request === loadId) loading.value = false
    }
  }

  async function saveFile(path: string, body: string): Promise<boolean> {
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
      if (activeFile.value === path) originalContent.value = body
      return true
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to save script'
      return false
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
    apiUrl,
    fetchFiles,
    loadFile,
    saveFile,
  }
})
