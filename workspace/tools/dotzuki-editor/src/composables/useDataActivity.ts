import { ref, computed } from 'vue'
import { useProjectStore } from '@/stores/project'
import { useEditorStore } from '@/stores/editor'
import type { TableDef, FieldDef } from '@/types'

// ── Module-level singleton state (shared across all callers) ──────────────
const selectedTableId = ref<string | null>(null)
const selectedRecord = ref<any | null>(null)
const records = ref<any[]>([])
const loading = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)

// ── Default value factory per field type ──────────────────────────────────
function fieldDefault(type: FieldDef['type'], options?: string[]): unknown {
  switch (type) {
    case 'string':   return ''
    case 'number':   return 0
    case 'boolean':  return false
    case 'select':   return options?.[0] ?? ''
    case 'multiselect': return []
    case 'array':    return []
    case 'object':   return {}
    case 'json':     return null
  }
}

function buildDefaultRecord(fields: FieldDef[]): Record<string, unknown> {
  const record: Record<string, unknown> = {}
  for (const f of fields) {
    record[f.key] = f.default !== undefined ? f.default : fieldDefault(f.type, f.options)
  }
  return record
}

// ── Shared composable ─────────────────────────────────────────────────────
export function useDataActivity() {
  const project = useProjectStore()
  const editor = useEditorStore()

  const activity = computed(() => {
    if (!editor.activeActivity) return undefined
    return project.getActivity(editor.activeActivity)
  })

  const tables = computed<TableDef[]>(() => {
    const cfg = activity.value?.config as { tables?: TableDef[] } | undefined
    return cfg?.tables ?? []
  })

  const currentTable = computed<TableDef | undefined>(() => {
    if (!selectedTableId.value) return undefined
    return tables.value.find((t: TableDef) => t.id === selectedTableId.value)
  })

  // ── Actions ───────────────────────────────────────────────────────────

  async function loadRecords(tableId: string) {
    loading.value = true
    error.value = null
    try {
      const resp = await fetch(`api/data/list/${tableId}`)
      if (!resp.ok) {
        const msg = await resp.json().then(j => j.error).catch(() => 'Unknown error')
        throw new Error(msg)
      }
      records.value = await resp.json()
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load records'
      records.value = []
    } finally {
      loading.value = false
    }
  }

  function selectTable(tableId: string) {
    selectedTableId.value = tableId
    selectedRecord.value = null
    error.value = null
    records.value = []
    loadRecords(tableId)
  }

  function newRecord() {
    if (!currentTable.value) return
    selectedRecord.value = buildDefaultRecord(currentTable.value.fields)
  }

  async function saveRecord(data: Record<string, unknown>) {
    if (!selectedTableId.value || !currentTable.value) return
    const tableId = selectedTableId.value
    const idField = currentTable.value.idField ?? 'id'
    // Records live on disk as "<file>.json" and the save route takes the URL
    // file name verbatim. The form emits schema fields only (no `_file`), so
    // an existing record's on-disk name comes from the selected list entry;
    // a new record is written to "<id>.json".
    const existingFile = selectedRecord.value?._file as string | undefined
    const id = (data[idField] as string) ?? 'new-record'
    const fileName = existingFile ?? `${id}.json`

    saving.value = true
    error.value = null
    try {
      const resp = await fetch(`api/data/save/${tableId}/${fileName}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!resp.ok) {
        const msg = await resp.json().then(j => j.error).catch(() => 'Unknown error')
        throw new Error(msg)
      }
      await loadRecords(tableId)
      selectedRecord.value = null
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to save record'
    } finally {
      saving.value = false
    }
  }

  async function deleteRecord(fileName: string) {
    if (!selectedTableId.value) return
    const tableId = selectedTableId.value
    // Callers may pass a bare record id or the full on-disk file name; records
    // live on disk as "<name>.json" and the delete route matches verbatim.
    const file = fileName.endsWith('.json') ? fileName : `${fileName}.json`

    saving.value = true
    error.value = null
    try {
      const resp = await fetch(`api/data/delete/${tableId}/${file}`, { method: 'DELETE' })
      if (!resp.ok) {
        const msg = await resp.json().then(j => j.error).catch(() => 'Unknown error')
        throw new Error(msg)
      }
      await loadRecords(tableId)
      selectedRecord.value = null
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to delete record'
    } finally {
      saving.value = false
    }
  }

  return {
    selectedTableId,
    selectedRecord,
    records,
    loading,
    saving,
    error,
    tables,
    currentTable,
    selectTable,
    loadRecords,
    newRecord,
    saveRecord,
    deleteRecord,
  }
}
