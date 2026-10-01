import { Ban, Droplets, ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { api } from '../api'
import { ContextMenu } from '../components/ContextMenu'
import { Table } from '../components/Table'
import { useReportLoading } from '../components/useReportLoading'
import { useRequiredKubeContext } from '../hooks/useKubeContext'
import { useWatchedList } from '../hooks/useWatchedList'
import { makeFilterMatcher } from '../lib/filterQuery'
import { useK8sDeleteActions } from '../lib/k8sResourceActions'
import { AGE_DESC_SORT } from '../lib/tableSort'
import { nodePhase } from '../lib/workloadStatus'
import { useRowLinkActions, useWorkspaceRowLink } from '../lib/workspaceRowLink'

import { nodeColumns } from './NodesViewColumns'

import type { ContextMenuItem } from '../components/ContextMenu'
import type { NodeItem } from '../types'

type Props = {
  filter: string
  refreshKey: number
  onSelect: (n: NodeItem) => void
  onCount: (n: number) => void
  onLoading?: (loading: boolean) => void
}

export function NodesView({ filter, refreshKey, onSelect, onCount, onLoading }: Props) {
  const context = useRequiredKubeContext()
  const {
    rows: items,
    loading,
    error,
    changedCells,
  } = useWatchedList<NodeItem>({
    context,
    kind: 'Node',
    namespace: null,
    rowKey: (r) => `/${r.name}`,
    scopeKey: 'nodes',
    refreshKey,
  })

  useReportLoading(loading, onLoading)

  // Snapshot context with the menu so cordon/uncordon run against the cluster
  // the user *saw* — not whichever cluster the tab is pointed at by the time
  // they click the confirm button.
  const [menu, setMenu] = useState<{
    node: NodeItem
    x: number
    y: number
    context: string
  } | null>(null)

  const { linkForRow } = useWorkspaceRowLink()
  const getRowLink = useCallback(
    (n: NodeItem) =>
      linkForRow({
        target: { kind: 'Node', namespace: null, name: n.name },
      }),
    [linkForRow],
  )
  const linkActions = useRowLinkActions(getRowLink)
  const getDeleteTarget = useCallback(
    (node: NodeItem) => ({ kind: 'Node', namespace: null, name: node.name }),
    [],
  )
  const deleteActions = useK8sDeleteActions<NodeItem>(getDeleteTarget)

  function buildNodeMenu(node: NodeItem, actionContext: string): ContextMenuItem[] {
    const linkItems = linkActions(node)
    const deleteItems = deleteActions(node, actionContext)

    return [
      ...linkItems,
      ...(linkItems.length > 0 ? [{ key: 'sep0', separator: true } as const] : []),
      node.schedulable
        ? {
            key: 'cordon',
            label: 'Cordon (mark unschedulable)',
            icon: Ban,
            confirm: `Cordon node "${node.name}"? New pods will not be scheduled here, but existing pods stay.`,
            onSelect: async () => {
              await api.cordonNode(actionContext, node.name, true)
            },
          }
        : {
            key: 'uncordon',
            label: 'Uncordon (mark schedulable)',
            icon: ShieldCheck,
            onSelect: async () => {
              await api.cordonNode(actionContext, node.name, false)
            },
          },
      {
        key: 'drain',
        label: 'Drain',
        icon: Droplets,
        disabled: true,
        hint: 'soon',
        onSelect: () => undefined,
      },
      { key: 'sep1', separator: true },
      ...deleteItems,
    ]
  }

  const matcher = useMemo(
    () =>
      makeFilterMatcher<NodeItem>(filter, (n) => ({
        text: [n.name, n.status, ...n.roles, ...n.taints, ...n.conditions],
        fields: { status: nodePhase(n), role: n.roles, taint: n.taints, condition: n.conditions },
      })),
    [filter],
  )
  const filtered = items.filter(matcher)

  useEffect(() => {
    onCount(filtered.length)
  }, [filtered.length, onCount])

  if (error) {
    return (
      <div className="p-8 text-center">
        <div className="text-error text-[13px]">{error}</div>
      </div>
    )
  }

  return (
    <>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={buildNodeMenu(menu.node, menu.context)}
          onClose={() => setMenu(null)}
        />
      )}
      <Table<NodeItem>
        loading={loading}
        rows={filtered}
        rowKey={(r) => r.name}
        onPrimaryAction={onSelect}
        onRowContextMenu={(n, e) => setMenu({ node: n, x: e.clientX, y: e.clientY, context })}
        storageKey="nodes"
        defaultSort={AGE_DESC_SORT}
        changedCells={changedCells}
        columns={nodeColumns}
      />
    </>
  )
}
