import { Trash2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'

import { api } from '../api'
import { ContextMenu } from '../components/ContextMenu'
import { useRequiredKubeContext } from '../hooks/useKubeContext'

import { useRowLinkActions } from './workspaceRowLink'

import type { ContextMenuItem } from '../components/ContextMenu'
import type { ReactNode } from 'react'

export type K8sDeleteTarget = {
  kind: string
  namespace: string | null
  name: string
  apiVersion?: string
}

function resourceLabel(target: K8sDeleteTarget): string {
  return target.namespace ? `${target.namespace}/${target.name}` : target.name
}

export function useK8sDeleteActions<T>(
  getTarget: (row: T) => K8sDeleteTarget | null | undefined,
): (row: T, context: string) => ContextMenuItem[] {
  return useCallback(
    (row: T, context: string) => {
      const target = getTarget(row)

      if (!target) return []

      return [
        {
          key: 'delete-resource',
          label: `Delete ${target.kind}`,
          icon: Trash2,
          destructive: true,
          confirm: `Delete ${target.kind} "${resourceLabel(target)}"? This is irreversible.`,
          onSelect: async () => {
            await api.deleteResource(
              context,
              target.kind,
              target.namespace,
              target.name,
              target.apiVersion,
            )
          },
        },
      ]
    },
    [getTarget],
  )
}

export function useK8sResourceRowMenu<T>(
  getLink: ((row: T) => string | null) | null | undefined,
  getDeleteTarget: (row: T) => K8sDeleteTarget | null | undefined,
  getExtraActions?: (row: T, context: string) => ContextMenuItem[],
): {
  onRowContextMenu: (row: T, e: { clientX: number; clientY: number }) => void
  menu: ReactNode
} {
  const context = useRequiredKubeContext()
  const linkActions = useRowLinkActions(getLink)
  const deleteActions = useK8sDeleteActions(getDeleteTarget)
  const [open, setOpen] = useState<{ row: T; x: number; y: number; context: string } | null>(null)

  const onRowContextMenu = useCallback(
    (row: T, e: { clientX: number; clientY: number }) => {
      setOpen({ row, x: e.clientX, y: e.clientY, context })
    },
    [context],
  )

  const items = useMemo(() => {
    if (!open) return []
    const linkItems = linkActions(open.row)
    const extraItems = getExtraActions?.(open.row, open.context) ?? []
    const deleteItems = deleteActions(open.row, open.context)

    return [
      ...linkItems,
      ...(linkItems.length > 0 && (extraItems.length > 0 || deleteItems.length > 0)
        ? [{ key: 'delete-separator', separator: true } as const]
        : []),
      ...extraItems,
      ...(extraItems.length > 0 && deleteItems.length > 0
        ? [{ key: 'extra-delete-separator', separator: true } as const]
        : []),
      ...deleteItems,
    ]
  }, [deleteActions, getExtraActions, linkActions, open])

  const menu =
    open && items.length > 0 ? (
      <ContextMenu x={open.x} y={open.y} items={items} onClose={() => setOpen(null)} />
    ) : null

  return { onRowContextMenu, menu }
}
