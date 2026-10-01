import { faPen, faRotateLeft, faSliders } from '@fortawesome/free-solid-svg-icons'
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
import { useK8sDeleteActions } from '../lib/k8sResourceActions'
import { AGE_DESC_SORT } from '../lib/tableSort'
import { useRowSelection } from '../lib/useRowSelection'
import { deploymentPhase } from '../lib/workloadStatus'
import { useRowLinkActions, useWorkspaceRowLink } from '../lib/workspaceRowLink'

import { deploymentColumns } from './DeploymentsViewColumns'
import { BulkScaleDialog, ScaleDeploymentDialog } from './DeploymentsViewDialogs'

import type { ContextMenuItem } from '../components/ContextMenu'
import type { DeploymentItem } from '../types'

type Props = {
  namespace: string
  filter: string
  refreshKey: number
  onSelect: (d: DeploymentItem, initialTab?: string) => void
  onCount: (n: number) => void
  onLoading?: (loading: boolean) => void
}

export function DeploymentsView({
  namespace,
  filter,
  refreshKey,
  onSelect,
  onCount,
  onLoading,
}: Props) {
  const context = useRequiredKubeContext()
  const {
    rows: items,
    loading,
    error,
    changedCells,
  } = useWatchedList<DeploymentItem>({
    context,
    kind: 'Deployment',
    namespace: namespace || null,
    rowKey: (r) => `${r.namespace}/${r.name}`,
    scopeKey: `deployments:${namespace}`,
    refreshKey,
  })

  useReportLoading(loading, onLoading)

  const matcher = useMemo(
    () =>
      makeFilterMatcher<DeploymentItem>(filter, (d) => ({
        text: [d.name, d.namespace],
        fields: {
          status: deploymentPhase(d),
          ns: d.namespace,
          namespace: d.namespace,
          ready: d.ready,
        },
      })),
    [filter],
  )
  const filtered = items.filter(matcher)

  useEffect(() => {
    onCount(filtered.length)
  }, [filtered.length, onCount])

  const { linkForRow } = useWorkspaceRowLink()
  const getRowLink = useCallback(
    (r: DeploymentItem) =>
      linkForRow({
        target: { kind: 'Deployment', namespace: r.namespace, name: r.name },
      }),
    [linkForRow],
  )
  const linkActions = useRowLinkActions(getRowLink)
  const getDeleteTarget = useCallback(
    (deployment: DeploymentItem) => ({
      kind: 'Deployment',
      namespace: deployment.namespace,
      name: deployment.name,
    }),
    [],
  )
  const deleteActions = useK8sDeleteActions<DeploymentItem>(getDeleteTarget)
  const [menu, setMenu] = useState<{
    deployment: DeploymentItem
    x: number
    y: number
    context: string
  } | null>(null)
  const [scaleTarget, setScaleTarget] = useState<{
    deployment: DeploymentItem
    context: string
  } | null>(null)

  // Row multi-select + bulk Rollout Restart / Scale.
  const {
    selectedKeys,
    setSelectedKeys,
    selectedItems,
    clear: clearSelection,
  } = useRowSelection(filtered, (d) => `${d.namespace}/${d.name}`, `${context}:${namespace}`)
  const [confirmRestart, setConfirmRestart] = useState(false)
  const [bulkScale, setBulkScale] = useState(false)

  function buildDeploymentMenu(
    deployment: DeploymentItem,
    actionContext: string,
  ): ContextMenuItem[] {
    const linkItems = linkActions(deployment)
    const deleteItems = deleteActions(deployment, actionContext)

    return [
      ...linkItems,
      ...(linkItems.length > 0 ? [{ key: 'sep0', separator: true } as const] : []),
      {
        key: 'env',
        label: 'Edit environment',
        icon: faPen,
        onSelect: () => onSelect(deployment, 'Env'),
      },
      {
        key: 'scale',
        label: 'Scale replicas',
        icon: faSliders,
        onSelect: () => setScaleTarget({ deployment, context: actionContext }),
      },
      {
        key: 'restart',
        label: 'Restart rollout',
        icon: faRotateLeft,
        confirm: `Restart deployment "${deployment.name}"? Kubernetes will roll out new pods.`,
        onSelect: async () => {
          await api.restartDeployment(actionContext, deployment.namespace, deployment.name)
        },
      },
      ...(deleteItems.length > 0 ? [{ key: 'sep1', separator: true } as const] : []),
      ...deleteItems,
    ]
  }

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
          items={buildDeploymentMenu(menu.deployment, menu.context)}
          onClose={() => setMenu(null)}
        />
      )}
      {scaleTarget && (
        <ScaleDeploymentDialog target={scaleTarget} onClose={() => setScaleTarget(null)} />
      )}
      <ConfirmDialog
        open={confirmRestart}
        title="Restart rollout"
        description={`Restart ${String(selectedItems.length)} deployment${selectedItems.length === 1 ? '' : 's'}? Kubernetes will roll out new pods for each.`}
        confirmLabel="Restart"
        onConfirm={async () => {
          const targets = selectedItems

          setConfirmRestart(false)
          await runBulk(targets, (d) => api.restartDeployment(context, d.namespace, d.name), {
            verbing: 'restart',
            verbed: 'Restarted',
            noun: 'deployment',
          })
          clearSelection()
        }}
        onClose={() => setConfirmRestart(false)}
      />
      {bulkScale && (
        <BulkScaleDialog
          count={selectedItems.length}
          onClose={() => setBulkScale(false)}
          onApply={async (replicas) => {
            const targets = selectedItems

            setBulkScale(false)
            await runBulk(
              targets,
              (d) => api.scaleDeployment(context, d.namespace, d.name, replicas),
              { verbing: 'scale', verbed: 'Scaled', noun: 'deployment' },
            )
            clearSelection()
          }}
        />
      )}
      <BulkActionBar
        count={selectedItems.length}
        onClear={clearSelection}
        actions={[
          {
            key: 'restart',
            label: 'Restart rollout',
            icon: faRotateLeft,
            onClick: () => setConfirmRestart(true),
          },
          {
            key: 'scale',
            label: 'Scale',
            icon: faSliders,
            onClick: () => setBulkScale(true),
          },
        ]}
      />
      <Table<DeploymentItem>
        loading={loading}
        rows={filtered}
        rowKey={(r) => `${r.namespace}/${r.name}`}
        onPrimaryAction={onSelect}
        onRowContextMenu={(deployment, e) =>
          setMenu({ deployment, x: e.clientX, y: e.clientY, context })
        }
        selectable
        selectedKeys={selectedKeys}
        onSelectedKeysChange={setSelectedKeys}
        storageKey="deployments"
        defaultSort={AGE_DESC_SORT}
        changedCells={changedCells}
        columns={deploymentColumns}
      />
    </>
  )
}
