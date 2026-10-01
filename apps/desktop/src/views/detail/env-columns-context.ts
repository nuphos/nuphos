import type { ContainerEnvDraft, EnvDraftRow, EnvEditingCell, EnvFromDraftRow } from './env-model'
import type { DetailTarget } from './target'
import type { ConfigMapItem, SecretItem } from '../../types'
import type { Dispatch, FocusEvent, KeyboardEvent, SetStateAction } from 'react'

// Everything the per-render column builders need from DeploymentEnvTab's
// closure. Rebuilt every render, exactly like the original inline arrays.
export type EnvColumnsContext = {
  namespace: string
  onNavigate?: (target: DetailTarget) => void
  configMaps: ConfigMapItem[]
  secrets: SecretItem[]
  selectedKey: string | null
  selectedDraft: ContainerEnvDraft
  editing: (
    table: EnvEditingCell['table'],
    rowId: string,
    column: EnvEditingCell['column'],
  ) => boolean
  setEditingCell: (cell: EnvEditingCell | null) => void
  closeEditing: () => void
  handleEditKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
  handleMultiFieldBlur: (event: FocusEvent<HTMLDivElement>) => void
  updateDraft: (key: string, next: ContainerEnvDraft) => void
  updateEnvRow: (rowId: string, patch: Partial<EnvDraftRow>) => void
  updateEnvFromRow: (rowId: string, patch: Partial<EnvFromDraftRow>) => void
}

export function createEnvColumnsContext({
  namespace,
  onNavigate,
  configMaps,
  secrets,
  selectedKey,
  selectedDraft,
  editingCell,
  setEditingCell,
  setDrafts,
}: {
  namespace: string
  onNavigate?: (target: DetailTarget) => void
  configMaps: ConfigMapItem[]
  secrets: SecretItem[]
  selectedKey: string | null
  selectedDraft: ContainerEnvDraft
  editingCell: EnvEditingCell | null
  setEditingCell: (cell: EnvEditingCell | null) => void
  setDrafts: Dispatch<SetStateAction<Record<string, ContainerEnvDraft>>>
}): EnvColumnsContext {
  function updateDraft(key: string, next: ContainerEnvDraft) {
    setDrafts((current) => ({ ...current, [key]: next }))
  }

  function updateEnvRow(rowId: string, patch: Partial<EnvDraftRow>) {
    if (!selectedKey) return
    updateDraft(selectedKey, {
      ...selectedDraft,
      env: selectedDraft.env.map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
    })
  }

  function updateEnvFromRow(rowId: string, patch: Partial<EnvFromDraftRow>) {
    if (!selectedKey) return
    updateDraft(selectedKey, {
      ...selectedDraft,
      envFrom: selectedDraft.envFrom.map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
    })
  }

  function editing(
    table: EnvEditingCell['table'],
    rowId: string,
    column: EnvEditingCell['column'],
  ) {
    return (
      editingCell?.table === table && editingCell.rowId === rowId && editingCell.column === column
    )
  }

  function closeEditing() {
    setEditingCell(null)
  }

  function handleEditKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === 'Escape') {
      event.currentTarget.blur()
      closeEditing()
    }
  }

  function handleMultiFieldBlur(event: FocusEvent<HTMLDivElement>) {
    const nextFocused = event.relatedTarget

    if (nextFocused instanceof Node && event.currentTarget.contains(nextFocused)) return
    closeEditing()
  }

  return {
    namespace,
    onNavigate,
    configMaps,
    secrets,
    selectedKey,
    selectedDraft,
    editing,
    setEditingCell,
    closeEditing,
    handleEditKeyDown,
    handleMultiFieldBlur,
    updateDraft,
    updateEnvRow,
    updateEnvFromRow,
  }
}
