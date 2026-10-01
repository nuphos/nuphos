import { api } from '../../api'
import { StatusBadge } from '../../components/StatusBadge'
import { pvPhase } from '../../lib/workloadStatus'

import { includes, persistentVolumeClaimDeleteTarget, persistentVolumeDeleteTarget } from './shared'
import { ClusterTable, NamespacedTable } from './tables'
import { ChipList } from './ui'

import type { BaseProps, NamespacedProps } from './shared'
import type { PersistentVolumeClaimItem, PersistentVolumeItem } from '../../types'

export function PersistentVolumesView({
  onSelectClaim,
  onSelectStorageClass,
  ...props
}: BaseProps<PersistentVolumeItem> & {
  onSelectClaim?: (namespace: string, name: string) => void
  onSelectStorageClass?: (name: string) => void
}) {
  return (
    <ClusterTable
      {...props}
      loader={api.listPersistentVolumes}
      storageKey="persistent-volumes"
      deleteTarget={persistentVolumeDeleteTarget}
      filterRecord={(r) => ({
        text: [r.name, r.status, r.claim, r.storage_class],
        fields: {
          status: pvPhase(r),
          storageclass: r.storage_class,
        },
      })}
      columns={[
        {
          key: 'status',
          header: 'Status',
          width: 120,
          sortAccessor: (r) => r.status,
          render: (r) => <StatusBadge status={r.status} />,
        },
        {
          key: 'capacity',
          header: 'Capacity',
          width: 110,
          sortAccessor: (r) => r.capacity ?? '',
          render: (r) => (
            <span className="font-mono text-[12px] text-secondary">{r.capacity || '-'}</span>
          ),
        },
        {
          key: 'access_modes',
          header: 'Access',
          width: 140,
          sortAccessor: (r) => r.access_modes.join(','),
          render: (r) => <ChipList values={r.access_modes} />,
        },
        {
          key: 'reclaim_policy',
          header: 'Reclaim',
          width: 110,
          sortAccessor: (r) => r.reclaim_policy,
          render: (r) => <span className="text-secondary">{r.reclaim_policy || '-'}</span>,
        },
        {
          key: 'claim',
          header: 'Claim',
          width: 220,
          sortAccessor: (r) => r.claim ?? '',
          render: (r) => (
            <span className="font-mono text-[12px] text-secondary">{r.claim || '-'}</span>
          ),
          onActivate: onSelectClaim
            ? (r) => {
                const [namespace, name] = r.claim?.split('/') ?? []

                if (namespace && name) onSelectClaim(namespace, name)
              }
            : undefined,
          canActivate: (r) => r.claim?.split('/').length === 2,
          activationLabel: (r) => `Open claim ${r.claim ?? ''}`,
        },
        {
          key: 'storage_class',
          header: 'Storage Class',
          width: 180,
          sortAccessor: (r) => r.storage_class ?? '',
          render: (r) => <span className="text-secondary">{r.storage_class || '-'}</span>,
          onActivate: onSelectStorageClass
            ? (r) => {
                if (r.storage_class) onSelectStorageClass(r.storage_class)
              }
            : undefined,
          canActivate: (r) => Boolean(r.storage_class),
          activationLabel: (r) => `Open storage class ${r.storage_class ?? ''}`,
        },
      ]}
    />
  )
}

export function PersistentVolumeClaimsView({
  onSelectVolume,
  onSelectStorageClass,
  ...props
}: NamespacedProps<PersistentVolumeClaimItem> & {
  onSelectVolume?: (name: string) => void
  onSelectStorageClass?: (name: string) => void
}) {
  return (
    <NamespacedTable
      {...props}
      loader={api.listPersistentVolumeClaims}
      storageKey="persistent-volume-claims"
      deleteTarget={persistentVolumeClaimDeleteTarget}
      matches={(r, f) =>
        includes(r.name, f) ||
        includes(r.namespace, f) ||
        includes(r.status, f) ||
        includes(r.volume, f) ||
        includes(r.storage_class, f)
      }
      columns={[
        {
          key: 'status',
          header: 'Status',
          width: 120,
          sortAccessor: (r) => r.status,
          render: (r) => <StatusBadge status={r.status} />,
        },
        {
          key: 'capacity',
          header: 'Capacity',
          width: 110,
          sortAccessor: (r) => r.capacity ?? '',
          render: (r) => (
            <span className="font-mono text-[12px] text-secondary">{r.capacity || '-'}</span>
          ),
        },
        {
          key: 'access_modes',
          header: 'Access',
          width: 140,
          sortAccessor: (r) => r.access_modes.join(','),
          render: (r) => <ChipList values={r.access_modes} />,
        },
        {
          key: 'volume',
          header: 'Volume',
          width: 220,
          sortAccessor: (r) => r.volume ?? '',
          render: (r) => (
            <span className="font-mono text-[12px] text-secondary">{r.volume || '-'}</span>
          ),
          onActivate: onSelectVolume
            ? (r) => {
                if (r.volume) onSelectVolume(r.volume)
              }
            : undefined,
          canActivate: (r) => Boolean(r.volume),
          activationLabel: (r) => `Open volume ${r.volume ?? ''}`,
        },
        {
          key: 'storage_class',
          header: 'Storage Class',
          width: 180,
          sortAccessor: (r) => r.storage_class ?? '',
          render: (r) => <span className="text-secondary">{r.storage_class || '-'}</span>,
          onActivate: onSelectStorageClass
            ? (r) => {
                if (r.storage_class) onSelectStorageClass(r.storage_class)
              }
            : undefined,
          canActivate: (r) => Boolean(r.storage_class),
          activationLabel: (r) => `Open storage class ${r.storage_class ?? ''}`,
        },
      ]}
    />
  )
}
