import { Network } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { Age } from '../components/Age'
import { ContextMenu } from '../components/ContextMenu'
import { Table } from '../components/Table'
import { useReportLoading } from '../components/useReportLoading'
import { useRequiredKubeContext } from '../hooks/useKubeContext'
import { useWatchedList } from '../hooks/useWatchedList'
import { useK8sDeleteActions } from '../lib/k8sResourceActions'
import { AGE_DESC_SORT } from '../lib/tableSort'
import { useRowLinkActions, useWorkspaceRowLink } from '../lib/workspaceRowLink'

import { PortForwardDialog } from './PortForwardDialog'

import type { ContextMenuItem } from '../components/ContextMenu'
import type { ServiceItem } from '../types'

type Props = {
  namespace: string
  filter: string
  refreshKey: number
  onSelect: (s: ServiceItem) => void
  onCount: (n: number) => void
  onLoading?: (loading: boolean) => void
}

export function ServicesView({
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
  } = useWatchedList<ServiceItem>({
    context,
    kind: 'Service',
    namespace: namespace || null,
    rowKey: (r) => `${r.namespace}/${r.name}`,
    scopeKey: `services:${namespace}`,
    refreshKey,
  })

  useReportLoading(loading, onLoading)

  // Capture the kubeconfig context at the moment the menu/dialog is opened
  // so a later cluster switch can't reroute the action to a different cluster.
  const [menu, setMenu] = useState<{
    service: ServiceItem
    x: number
    y: number
    context: string
  } | null>(null)
  const [portForwardTarget, setPortForwardTarget] = useState<{
    service: ServiceItem
    context: string
  } | null>(null)

  const { linkForRow } = useWorkspaceRowLink()
  const getRowLink = useCallback(
    (s: ServiceItem) =>
      linkForRow({
        target: { kind: 'Service', namespace: s.namespace, name: s.name },
      }),
    [linkForRow],
  )
  const linkActions = useRowLinkActions(getRowLink)
  const getDeleteTarget = useCallback(
    (service: ServiceItem) => ({
      kind: 'Service',
      namespace: service.namespace,
      name: service.name,
    }),
    [],
  )
  const deleteActions = useK8sDeleteActions<ServiceItem>(getDeleteTarget)

  function buildServiceMenu(service: ServiceItem, actionContext: string): ContextMenuItem[] {
    const linkItems = linkActions(service)
    const deleteItems = deleteActions(service, actionContext)

    return [
      ...linkItems,
      ...(linkItems.length > 0 ? [{ key: 'sep0', separator: true } as const] : []),
      {
        key: 'port-forward',
        label: 'Port forward',
        icon: Network,
        disabled: service.servicePorts.length === 0,
        hint: service.servicePorts.length === 0 ? 'no TCP ports' : undefined,
        onSelect: () => setPortForwardTarget({ service, context: actionContext }),
      },
      ...(deleteItems.length > 0 ? [{ key: 'sep1', separator: true } as const] : []),
      ...deleteItems,
    ]
  }

  const filtered = items.filter((p) => {
    if (!filter) return true
    const f = filter.toLowerCase()

    return p.name.toLowerCase().includes(f) || p.namespace.toLowerCase().includes(f)
  })

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
          items={buildServiceMenu(menu.service, menu.context)}
          onClose={() => setMenu(null)}
        />
      )}
      {portForwardTarget && (
        <PortForwardDialog
          open
          context={portForwardTarget.context}
          target={{
            kind: 'Service',
            namespace: portForwardTarget.service.namespace,
            name: portForwardTarget.service.name,
            ports: portForwardTarget.service.servicePorts,
          }}
          onClose={() => setPortForwardTarget(null)}
        />
      )}
      <Table<ServiceItem>
        loading={loading}
        rows={filtered}
        rowKey={(r) => `${r.namespace}/${r.name}`}
        onPrimaryAction={onSelect}
        onRowContextMenu={(service, e) => setMenu({ service, x: e.clientX, y: e.clientY, context })}
        storageKey="services"
        defaultSort={AGE_DESC_SORT}
        changedCells={changedCells}
        columns={[
          {
            key: 'namespace',
            header: 'Namespace',
            width: 160,
            sortAccessor: (r) => r.namespace,
            render: (r) => <span className="text-secondary">{r.namespace}</span>,
          },
          {
            key: 'name',
            header: 'Name',
            width: 240,
            sortAccessor: (r) => r.name,
            render: (r) => <span className="text-zViolet-accent">{r.name}</span>,
          },
          {
            key: 'kind',
            header: 'Type',
            width: 110,
            sortAccessor: (r) => r.kind,
            render: (r) => <span className="text-secondary">{r.kind}</span>,
          },
          {
            key: 'cluster_ip',
            header: 'Cluster IP',
            width: 130,
            sortAccessor: (r) => r.cluster_ip ?? '',
            render: (r) => (
              <span className="text-secondary font-mono text-[12px]">{r.cluster_ip || '-'}</span>
            ),
          },
          {
            key: 'external_ips',
            header: 'External IPs',
            width: 160,
            sortAccessor: (r) => r.external_ips.join(','),
            render: (r) => (
              <span className="text-secondary font-mono text-[12px]">
                {r.external_ips.join(', ') || '-'}
              </span>
            ),
          },
          {
            key: 'ports',
            header: 'Ports',
            width: 200,
            sortAccessor: (r) => r.ports.join(','),
            render: (r) => (
              <span className="text-secondary font-mono text-[12px]">
                {r.ports.join(', ') || '-'}
              </span>
            ),
          },
          {
            key: 'age',
            header: 'Age',
            width: 100,
            sortAccessor: (r) => r.age ?? '',
            render: (r) => (
              <span className="text-tertiary">
                <Age value={r.age} />
              </span>
            ),
          },
        ]}
      />
    </>
  )
}
