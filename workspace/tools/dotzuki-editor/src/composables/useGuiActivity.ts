import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

/** Pinia store backing the UI-layout (`.gui`) activity — shared between the
 *  sidebar (file list) and the main editor. Mirrors `useScriptActivity` but
 *  talks to the `/api/gui` endpoints (resolved server-side against `guiRoot`). */
export const useGuiActivity = defineStore('guiActivity', () => {
  const files = ref<string[]>([])
  const activeFile = ref<string>('')
  const content = ref<string>('')
  const originalContent = ref<string>('')
  const loading = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)

  const dirty = computed(() => content.value !== originalContent.value)

  async function fetchFiles(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const resp = await fetch('api/gui')
      if (!resp.ok) {
        const msg = await resp.json().then(j => j.error).catch(() => 'Unknown error')
        throw new Error(msg)
      }
      files.value = (await resp.json() as string[]).slice().sort()
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to list layouts'
      files.value = []
    } finally {
      loading.value = false
    }
  }

  async function loadFile(name: string): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const resp = await fetch(`api/gui/${encodeURIComponent(name)}`)
      if (!resp.ok) {
        const msg = await resp.json().then(j => j.error).catch(() => 'Unknown error')
        throw new Error(msg)
      }
      const text = await resp.text()
      activeFile.value = name
      originalContent.value = text
      content.value = text
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load layout'
    } finally {
      loading.value = false
    }
  }

  async function saveFile(name: string, body: string): Promise<void> {
    saving.value = true
    error.value = null
    try {
      const resp = await fetch(`api/gui/${encodeURIComponent(name)}`, {
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
      error.value = e instanceof Error ? e.message : 'Failed to save layout'
    } finally {
      saving.value = false
    }
  }

  return {
    files, activeFile, content, originalContent, dirty, loading, saving, error,
    fetchFiles, loadFile, saveFile,
  }
})
