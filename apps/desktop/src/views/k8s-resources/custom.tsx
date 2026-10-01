import { useCallback, useEffect } from 'react'

import { api } from '../../api'
import { Age } from '../../components/Age'
import { StatusBadge } from '../../components/StatusBadge'
import { Table } from '../../components/Table'
import { useReportLoading } from '../../components/useReportLoading'
import { useRequiredKubeContext } from '../../hooks/useKubeContext'
import { usePolledList } from '../../hooks/usePolledList'
import { useK8sResourceRowMenu } from '../../lib/k8sResourceActions'

import { crdDeleteTarget, includes } from './shared'
import { ClusterTable } from './tables'
import { ChipList, ErrorState } from './ui'

import type { BaseProps, NamespacedProps } from './shared'
import type {
  CustomResourceDefinitionItem,
  CustomResourceItem,
  CustomResourceType,
} from '../../types'

export function CustomResourceDefinitionsView(props: BaseProps<CustomResourceDefinitionItem>) {
  return (
    <ClusterTable
      {...props}
      loader={api.listCustomResourceDefinitions}
      storageKey="crds"
      deleteTarget={crdDeleteTarget}
      matches={(r, f) =>
        includes(r.name, f) || includes(r.group, f) || includes(r.kind, f) || includes(r.plural, f)
      }
      columns={[
        {
          key: 'kind',
          header: 'Kind',
          width: 190,
          sortAccessor: (r) => r.kind,
          render: (r) => <span className="text-main">{r.kind}</span>,
        },
        {
          key: 'group',
          header: 'Group',
          width: 260,
          sortAccessor: (r) => r.group,
          render: (r) => <span className="font-mono text-[12px] text-secondary">{r.group}</span>,
        },
        {
          key: 'scope',
          header: 'Scope',
          width: 120,
          sortAccessor: (r) => r.scope,
          render: (r) => <span className="text-secondary">{r.scope}</span>,
        },
        {
          key: 'versions',
          header: 'Versions',
          width: 190,
          sortAccessor: (r) => r.versions.join(','),
          render: (r) => <ChipList values={r.versions} />,
        },
      ]}
    />
  )
}

export function CustomResourcesView(
  props: NamespacedProps<CustomResourceItem> & { resourceType?: CustomResourceType },
) {
  const { namespace, filter, refreshKey, onSelect, onCount, onLoading, resourceType } = props
  const context = useRequiredKubeContext()
  const resourceKey = resourceType
    ? `${resourceType.apiVersion}:${resourceType.plural}:${String(resourceType.namespaced)}`
    : 'all'
  const { rows, loading, error, changedCells } = usePolledList<CustomResourceItem>({
    loader: () =>
      resourceType
        ? api.listCustomResourceType(context, namespace, resourceType)
        : api.listCustomResources(context, namespace),
    rowKey: (r) => `${r.apiVersion}/${r.plural}/${r.namespace ?? ''}/${r.name}`,
    refreshKey,
    scopeKey: `custom-resources:${context}:${namespace}:${resourceKey}`,
  })

  useReportLoading(loading, onLoading)
  const f = filter.toLowerCase()
  const filtered = rows.filter(
    (r) =>
      includes(r.name, f) ||
      includes(r.namespace, f) ||
      includes(r.kind, f) ||
      includes(r.apiVersion, f) ||
      includes(r.status, f),
  )

  useEffect(() => onCount(filtered.length), [filtered.length, onCount])
  const getDeleteTarget = useCallback(
    (r: CustomResourceItem) => ({
      kind: r.kind,
      namespace: r.namespace ?? null,
      name: r.name,
      apiVersion: r.apiVersion,
    }),
    [],
  )
  const { onRowContextMenu, menu } = useK8sResourceRowMenu(null, getDeleteTarget)

  if (error) return <ErrorState message={error} />

  return (
    <>
      {menu}
      <Table<CustomResourceItem>
        loading={loading}
        rows={filtered}
        rowKey={(r) => `${r.apiVersion}/${r.plural}/${r.namespace ?? ''}/${r.name}`}
        onPrimaryAction={onSelect}
        onRowContextMenu={onRowContextMenu}
        storageKey="custom-resources"
        changedCells={changedCells}
        columns={[
          {
            key: 'namespace',
            header: 'Namespace',
            width: 150,
            sortAccessor: (r) => r.namespace ?? '',
            render: (r) => <span className="text-secondary">{r.namespace ?? '-'}</span>,
          },
          {
            key: 'name',
            header: 'Name',
            width: 280,
            sortAccessor: (r) => r.name,
            render: (r) => <span className="text-zViolet-accent">{r.name}</span>,
          },
          {
            key: 'kind',
            header: 'Kind',
            width: 190,
            sortAccessor: (r) => r.kind,
            render: (r) => <span className="text-main">{r.kind}</span>,
          },
          {
            key: 'apiVersion',
            header: 'API Version',
            width: 260,
            sortAccessor: (r) => r.apiVersion,
            render: (r) => (
              <span className="font-mono text-[12px] text-secondary">{r.apiVersion}</span>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            width: 140,
            sortAccessor: (r) => r.status,
            render: (r) =>
              r.status ? (
                <StatusBadge status={r.status} />
              ) : (
                <span className="text-tertiary">-</span>
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
