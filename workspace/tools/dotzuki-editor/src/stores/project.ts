import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { ProjectConfig, ActivityDef } from '@/types'

export const useProjectStore = defineStore('project', () => {
  const config = ref<ProjectConfig | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const enabledActivities = computed(() =>
    config.value?.activities.filter(a => a.enabled !== false) ?? []
  )

  async function loadConfig() {
    loading.value = true
    error.value = null
    try {
      const resp = await fetch('api/project')
      if (!resp.ok) {
        const msg = await resp.json().then(j => j.error).catch(() => 'Unknown error')
        throw new Error(msg)
      }
      config.value = await resp.json()
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load project config'
    } finally {
      loading.value = false
    }
  }

  function getActivity(id: string): ActivityDef | undefined {
    return config.value?.activities.find(a => a.id === id)
  }

  return { config, loading, error, enabledActivities, loadConfig, getActivity }
})
