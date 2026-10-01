import { faShieldHalved } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useEffect, useMemo, useState } from 'react'

import { api } from '../../api'
import { Age } from '../../components/Age'
import { ContextMenu } from '../../components/ContextMenu'
import { Modal } from '../../components/Modal'
import { StatusBadge } from '../../components/StatusBadge'
import { Table } from '../../components/Table'
import { toast } from '../../components/ui/toast'
import { useWorkspaceTab } from '../../hooks/useWorkspaceTab'
import { reportFrontendError } from '../../lib/frontendErrorReporter'
import {
  getEndpointOverride,
  isValidOverrideHost,
  setEndpointOverride,
} from '../../lib/endpointOverrides'
import { withResourceListCache, resourceListCacheKey } from '../../lib/resourceListCache'
import { useResourceList } from '../useResourceList'

import { applyFilter } from './filter'
import { ErrorBlock } from './shared'

import type { CommonProps } from './shared'
import type { ContextMenuItem } from '../../components/ContextMenu'
import type { LkeCluster } from '../../types'

export function LkeClustersView({
  teamId,
  accountId,
  filter,
  refreshKey,
  onCount,
  onLoading,
  onUseCluster,
}: CommonProps & {
  teamId: string
  accountId: string
  onUseCluster: (cluster: LkeCluster) => void
}) {
  const [menuState, setMenuState] = useState<{ cluster: LkeCluster; x: number; y: number } | null>(
    null,
  )
  // Endpoint-override editor. overrideTick re-renders rows after
  // a localStorage write so the shield marker updates without a reload.
  const [overrideDialog, setOverrideDialog] = useState<LkeCluster | null>(null)
  const [overrideInput, setOverrideInput] = useState('')
  const [, setOverrideTick] = useState(0)
  const { pollTick } = useWorkspaceTab()
  const loader = useMemo(
    () =>
      withResourceListCache(
        resourceListCacheKey('linode', [teamId, accountId, 'lke-clusters']),
        () => api.atlasListLkeClusters(teamId, accountId),
      ),
    [teamId, accountId],
  )
  const { items, loading, error } = useResourceList(loader, refreshKey, onLoading, { pollTick })

  const filtered = applyFilter(items, filter, (c) => `${c.label} ${c.region} ${c.k8s_version}`)

  useEffect(() => {
    onCount(filtered.length)
  }, [filtered.length, onCount])

  if (error) return <ErrorBlock message={error} />

  const menuItems = (cluster: LkeCluster): ContextMenuItem[] => {
    const override = getEndpointOverride(accountId, cluster.id)
    const items: ContextMenuItem[] = [
      { key: 'use', label: 'Use cluster', onSelect: () => onUseCluster(cluster) },
      {
        key: 'copy-label',
        label: 'Copy label',
        onSelect: () =>
          navigator.clipboard.writeText(cluster.label).catch((cause: unknown) => {
            reportFrontendError(
              { source: 'clipboard', phase: 'linode_cluster_name', message: 'Copy failed.' },
              cause,
            )
          }),
      },
      { key: 'sep', separator: true },
      {
        key: 'override',
        label: override ? 'Edit endpoint override…' : 'Set endpoint override…',
        onSelect: () => {
          setOverrideInput(override ?? '')
          setOverrideDialog(cluster)
        },
      },
    ]

    if (override) {
      items.push({
        key: 'clear-override',
        label: 'Clear endpoint override',
        destructive: true,
        onSelect: () => {
          setEndpointOverride(accountId, cluster.id, null)
          setOverrideTick((t) => t + 1)
          toast.success(
            'Endpoint override cleared',
            `${cluster.label} connects via the Linode endpoint again`,
          )
        },
      })
    }

    return items
  }

  const saveOverride = () => {
    if (!overrideDialog) return
    const host =
      overrideInput
        .trim()
        .replace(/^https?:\/\//, '')
        .split('/')[0] ?? ''

    if (!isValidOverrideHost(host)) {
      toast.error(
        'Invalid hostname',
        'Expected a bare hostname like kube-apiserver-foo.tailnet.ts.net',
      )

      return
    }
    setEndpointOverride(accountId, overrideDialog.id, host)
    setOverrideTick((t) => t + 1)
    toast.success('Endpoint override saved', `${overrideDialog.label} now connects via ${host}`)
    setOverrideDialog(null)
  }

  return (
    <>
      <Table
        loading={loading}
        columns={[
          {
            key: 'label',
            header: 'Label',
            render: (c) => (
              <span className="inline-flex items-center gap-1.5 font-mono text-[12px]">
                {c.label}
                {getEndpointOverride(accountId, c.id) && (
                  <FontAwesomeIcon
                    icon={faShieldHalved}
                    className="h-3 w-3 text-tertiary"
                    title={`Connects via ${String(getEndpointOverride(accountId, c.id))}`}
                  />
                )}
              </span>
            ),
            sortAccessor: (c) => c.label,
          },
          {
            key: 'region',
            header: 'Region',
            render: (c) => <span className="text-secondary">{c.region}</span>,
            sortAccessor: (c) => c.region,
          },
          {
            key: 'version',
            header: 'K8s Version',
            render: (c) => <span className="text-secondary text-[11.5px]">{c.k8s_version}</span>,
            sortAccessor: (c) => c.k8s_version,
          },
          {
            key: 'status',
            header: 'Status',
            render: (c) => <StatusBadge status={c.status} />,
            sortAccessor: (c) => c.status,
          },
          {
            key: 'age',
            header: 'Age',
            render: (c) =>
              c.created ? <Age value={c.created} /> : <span className="text-tertiary">—</span>,
            sortAccessor: (c) => c.created ?? '',
          },
        ]}
        rows={filtered}
        rowKey={(c) => String(c.id)}
        storageKey="linode.lke"
        defaultSort={{ key: 'label', dir: 'asc' }}
        onPrimaryAction={onUseCluster}
        onRowContextMenu={(cluster, e) => setMenuState({ cluster, x: e.clientX, y: e.clientY })}
      />
      {menuState && (
        <ContextMenu
          x={menuState.x}
          y={menuState.y}
          items={menuItems(menuState.cluster)}
          onClose={() => setMenuState(null)}
        />
      )}
      <Modal
        open={overrideDialog !== null}
        onClose={() => setOverrideDialog(null)}
        title="API server endpoint override"
        description="Connect to this cluster through an alternative API server endpoint instead of the provider's public one — e.g. a Tailscale operator proxy when the control plane is ACL-gated, or any VPN/private hostname. The endpoint must authenticate at the network layer. Stored on this machine only."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            saveOverride()
          }}
          className="flex flex-col gap-3 px-5 pb-5 pt-4"
        >
          <input
            type="text"
            autoFocus
            value={overrideInput}
            onChange={(e) => setOverrideInput(e.target.value)}
            placeholder="k8s-api.your-network.example.com"
            className="h-8 rounded-md border border-zGray-700 bg-field px-2.5 font-mono text-[12px] text-main placeholder:text-tertiary focus:border-zViolet-accent focus:outline-none"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOverrideDialog(null)}
              className="h-7 rounded-md px-3 text-[12px] text-secondary hover:bg-zGray-850"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="h-7 rounded-md bg-zViolet-accent px-3 text-[12px] font-medium text-white hover:opacity-90"
            >
              Save
            </button>
          </div>
        </form>
      </Modal>
    </>
  )
}
