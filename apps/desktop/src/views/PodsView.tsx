import { faRotateLeft, faTrash } from '@fortawesome/free-solid-svg-icons'
import { Network, RotateCcw, Terminal, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { api } from '../api'
import { BulkActionBar } from '../components/BulkActionBar'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ContextMenu } from '../components/ContextMenu'
import { Table } from '../components/Table'
import { useReportLoading } from '../components/useReportLoading'
import { useRequiredKubeContext } from '../hooks/useKubeContext'
import { useWatchedList } from '../hooks/useWatchedList'
import { runBulk } from '../lib/bulkActions'
import { makeFilterMatcher } from '../lib/filterQuery'
import { AGE_DESC_SORT } from '../lib/tableSort'
import { useRowSelection } from '../lib/useRowSelection'
import { podPhase } from '../lib/workloadStatus'
import { useRowLinkActions, useWorkspaceRowLink } from '../lib/workspaceRowLink'

import { podColumns } from './PodsViewColumns'
import { PortForwardDialog } from './PortForwardDialog'

import type { ContextMenuItem } from '../components/ContextMenu'
import type { PodItem } from '../types'

type Props = {
  namespace: string
  filter: string
  refreshKey: number
  onSelect: (p: PodItem) => void
  // Opens the pod detail straight on its Terminal tab. When omitted (e.g. the
  // workload detail's embedded pod list) the "Exec shell" action is disabled.
  onExec?: (p: PodItem) => void
  onSelectNode?: (nodeName: string) => void
  onCount: (n: number) => void
  onLoading?: (loading: boolean) => void
  // Optional secondary filter applied after the text-based `filter`. The
  // workload detail view passes a selector-based matcher here so the same
  // PodsView renders matched-only pods without duplicating the table.
  filterPod?: (p: PodItem) => boolean
  // Pinning the storage key lets the workload detail view get its own
  // column-width preferences without clobbering the global Pods table's.
  storageKey?: string
}

export function PodsView({
  namespace,
  filter,
  refreshKey,
  onSelect,
  onExec,
  onSelectNode,
  onCount,
  onLoading,
  filterPod,
  storageKey = 'pods',
}: Props) {
  const context = useRequiredKubeContext()
  const {
    rows: pods,
    loading,
    error,
    changedCells,
  } = useWatchedList<PodItem>({
    context,
    kind: 'Pod',
    namespace: namespace || null,
    rowKey: (p) => `${p.namespace}/${p.name}`,
    scopeKey: `pods:${namespace}`,
    refreshKey,
  })

  useReportLoading(loading, onLoading)

  // Row actions (context menu items, port-forward dialog) capture the context
  // at the moment they're opened — see the inline note on `actionContext`
  // below for the rationale.
  const [menu, setMenu] = useState<{ pod: PodItem; x: number; y: number; context: string } | null>(
    null,
  )
  const [portForwardTarget, setPortForwardTarget] = useState<{
    pod: PodItem
    context: string
  } | null>(null)

  const { linkForRow } = useWorkspaceRowLink()
  const getRowLink = useCallback(
    (pod: PodItem) =>
      linkForRow({
        target: { kind: 'Pod', namespace: pod.namespace, name: pod.name },
      }),
    [linkForRow],
  )
  const linkActions = useRowLinkActions(getRowLink)

  // `actionContext` is the context the user *saw* when they opened this menu.
  // Reading the live `context` at the moment the user clicks Delete would
  // route the action to whichever cluster the tab is pointed at *now*, which
  // could differ if the user switched clusters with the menu still open —
  // a same-named pod in the new cluster would get deleted instead.
  function buildPodMenu(pod: PodItem, actionContext: string): ContextMenuItem[] {
    const linkItems = linkActions(pod)

    return [
      ...linkItems,
      ...(linkItems.length > 0 ? [{ key: 'sep0', separator: true } as const] : []),
      {
        key: 'restart',
        label: 'Restart',
        icon: RotateCcw,
        confirm: `Restart pod "${pod.name}"? Kubernetes will recreate it via its controller.`,
        onSelect: async () => {
          await api.deletePod(actionContext, pod.namespace, pod.name)
        },
      },
      { key: 'sep1', separator: true },
      {
        key: 'port-forward',
        label: 'Port forward',
        icon: Network,
        onSelect: () => {
          setPortForwardTarget({ pod, context: actionContext })
        },
      },
      {
        key: 'exec',
        label: 'Exec shell',
        icon: Terminal,
        disabled: !onExec,
        hint: onExec ? undefined : 'soon',
        onSelect: () => onExec?.(pod),
      },
      { key: 'sep2', separator: true },
      {
        key: 'delete',
        label: 'Delete pod',
        icon: Trash2,
        destructive: true,
        confirm: `Delete pod "${pod.name}"? This is irreversible.`,
        onSelect: async () => {
          await api.deletePod(actionContext, pod.namespace, pod.name)
        },
      },
    ]
  }

  const matcher = useMemo(
    () =>
      makeFilterMatcher<PodItem>(filter, (p) => ({
        text: [p.name, p.namespace, p.status],
        fields: {
          // `status=` matches the overview phase (Running/Completed/…) or the
          // raw pod status string, so deep-links and manual queries both work.
          status: [podPhase(p), p.status],
          ns: p.namespace,
          namespace: p.namespace,
          node: p.node,
          ready: p.ready,
        },
      })),
    [filter],
  )
  const filtered = useMemo(
    () =>
      pods.filter((p) => {
        if (filterPod && !filterPod(p)) return false

        return matcher(p)
      }),
    [pods, matcher, filterPod],
  )
  const columns = useMemo(
    () =>
      podColumns.map((column) =>
        column.key === 'node' && onSelectNode
          ? {
              ...column,
              onActivate: (pod: PodItem) => {
                if (pod.node) onSelectNode(pod.node)
              },
              canActivate: (pod: PodItem) => Boolean(pod.node),
              activationLabel: (pod: PodItem) => `Open node ${pod.node ?? ''}`,
            }
          : column,
      ),
    [onSelectNode],
  )

  useEffect(() => {
    onCount(filtered.length)
  }, [filtered.length, onCount])

  const {
    selectedKeys,
    setSelectedKeys,
    selectedItems,
    clear: clearSelection,
  } = useRowSelection(filtered, (p) => `${p.namespace}/${p.name}`, `${context}:${namespace}`)
  const [confirmRestart, setConfirmRestart] = useState(false)

  if (error) {
    return (
      <div className="p-8 text-center">
        <div className="text-error text-[13px]">{error}</div>
      </div>
    )
  }

  return (
    <>
      <ConfirmDialog
        open={confirmRestart}
        title="Restart pods"
        description={`Restart ${String(selectedItems.length)} pod${selectedItems.length === 1 ? '' : 's'}? Pods managed by a controller are recreated; standalone pods are deleted.`}
        confirmLabel="Restart"
        onConfirm={async () => {
          const targets = selectedItems

          setConfirmRestart(false)
          await runBulk(targets, (p) => api.deletePod(context, p.namespace, p.name), {
            verbing: 'restart',
            verbed: 'Restarted',
            noun: 'pod',
          })
          clearSelection()
        }}
        onClose={() => setConfirmRestart(false)}
      />
      <BulkActionBar
        count={selectedItems.length}
        onClear={clearSelection}
        actions={[
          {
            key: 'restart',
            label: 'Restart',
            icon: faRotateLeft,
            onClick: () => setConfirmRestart(true),
          },
          {
            key: 'delete',
            label: 'Delete',
            icon: faTrash,
            destructive: true,
            confirm: `Delete ${String(selectedItems.length)} pod${selectedItems.length === 1 ? '' : 's'}? This is irreversible.`,
            onClick: async () => {
              const targets = selectedItems

              await runBulk(targets, (p) => api.deletePod(context, p.namespace, p.name), {
                verbing: 'delete',
                verbed: 'Deleted',
                noun: 'pod',
              })
              clearSelection()
            },
          },
        ]}
      />
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={buildPodMenu(menu.pod, menu.context)}
          onClose={() => setMenu(null)}
        />
      )}
      {portForwardTarget && (
        <PortForwardDialog
          open
          context={portForwardTarget.context}
          target={{
            kind: 'Pod',
            namespace: portForwardTarget.pod.namespace,
            name: portForwardTarget.pod.name,
            ports: portForwardTarget.pod.ports,
          }}
          onClose={() => setPortForwardTarget(null)}
        />
      )}
      <Table<PodItem>
        loading={loading}
        rows={filtered}
        rowKey={(r) => `${r.namespace}/${r.name}`}
        onPrimaryAction={onSelect}
        onRowContextMenu={(p, e) => setMenu({ pod: p, x: e.clientX, y: e.clientY, context })}
        selectable
        selectedKeys={selectedKeys}
        onSelectedKeysChange={setSelectedKeys}
        storageKey={storageKey}
        defaultSort={AGE_DESC_SORT}
        changedCells={changedCells}
        columns={columns}
      />
    </>
  )
}
