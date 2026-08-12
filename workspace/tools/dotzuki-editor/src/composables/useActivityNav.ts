// Cross-activity navigation: jump to the first enabled activity of a given type
// (e.g. open the Settings tab from a "configure AI providers" prompt). Mirrors
// App.vue's selectActivity (set the active activity + sync the route).
import { useRouter } from 'vue-router'
import { useProjectStore } from '@/stores/project'
import { useEditorStore } from '@/stores/editor'

export function useActivityNav() {
  const router = useRouter()
  const project = useProjectStore()
  const editor = useEditorStore()

  /** Switch to the first enabled activity of `type`. Returns false if none. */
  function goToType(type: string): boolean {
    const act = project.config?.activities.find(a => a.type === type && a.enabled !== false)
    if (!act) return false
    editor.setActivity(act.id)
    router.push(`/edit/${act.id}`)
    return true
  }

  return { goToType }
}
