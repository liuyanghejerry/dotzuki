import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useEditorStore = defineStore('editor', () => {
  const activeActivity = ref<string>('')
  const sidebarOpen = ref(true)
  const assistantOpen = ref(false)
  const helpOpen = ref(false)
  const saving = ref(false)
  const lastSaveTime = ref<number | null>(null)
  const pendingCharacterId = ref<string | null>(null)

  function setActivity(id: string) {
    activeActivity.value = id
  }

  function toggleSidebar() {
    sidebarOpen.value = !sidebarOpen.value
  }

  function toggleAssistant() {
    assistantOpen.value = !assistantOpen.value
  }

  function toggleHelp() {
    helpOpen.value = !helpOpen.value
  }

  function jumpToCharacter(charId: string) {
    pendingCharacterId.value = charId
    activeActivity.value = 'characters'
  }

  return { activeActivity, sidebarOpen, assistantOpen, helpOpen, saving, lastSaveTime, pendingCharacterId, setActivity, toggleSidebar, toggleAssistant, toggleHelp, jumpToCharacter }
})
