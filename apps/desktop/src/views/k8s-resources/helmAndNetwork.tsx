import { api } from '../../api'
import { StatusBadge } from '../../components/StatusBadge'

import { helmReleaseActions, includes, networkPolicyDeleteTarget } from './shared'
import { NamespacedTable } from './tables'
import { ChipList } from './ui'

import type { NamespacedProps } from './shared'
import type { HelmReleaseItem, NetworkPolicyItem } from '../../types'

export function HelmReleasesView(props: NamespacedProps<HelmReleaseItem>) {
  return (
    <NamespacedTable
      {...props}
      loader={api.listHelmReleases}
      storageKey="helm-releases"
      rowKey={(r) => `${r.namespace}/${r.storage_kind}/${r.storage_name}`}
      rowActions={helmReleaseActions}
      matches={(r, f) =>
        includes(r.name, f) ||
        includes(r.namespace, f) ||
        includes(r.chart, f) ||
        includes(r.status, f)
      }
      columns={[
        {
          key: 'revision',
          header: 'Rev',
          width: 70,
          sortAccessor: (r) => Number(r.revision || 0),
          render: (r) => r.revision || '-',
        },
        {
          key: 'status',
          header: 'Status',
          width: 110,
          sortAccessor: (r) => r.status,
          render: (r) => <StatusBadge status={r.status || 'Unknown'} />,
        },
        {
          key: 'chart',
          header: 'Chart',
          width: 240,
          sortAccessor: (r) => r.chart,
          render: (r) => <span className="text-secondary">{r.chart || '-'}</span>,
        },
        {
          key: 'app_version',
          header: 'App',
          width: 130,
          sortAccessor: (r) => r.app_version,
          render: (r) => <span className="text-secondary">{r.app_version || '-'}</span>,
        },
        {
          key: 'storage_kind',
          header: 'Storage',
          width: 110,
          sortAccessor: (r) => r.storage_kind,
          render: (r) => <span className="text-tertiary">{r.storage_kind}</span>,
        },
      ]}
    />
  )
}

export function NetworkPoliciesView(props: NamespacedProps<NetworkPolicyItem>) {
  return (
    <NamespacedTable
      {...props}
      loader={api.listNetworkPolicies}
      storageKey="network-policies"
      deleteTarget={networkPolicyDeleteTarget}
      matches={(r, f) =>
        includes(r.name, f) ||
        includes(r.namespace, f) ||
        includes(r.pod_selector, f) ||
        includes(r.policy_types, f)
      }
      columns={[
        {
          key: 'policy_types',
          header: 'Types',
          width: 170,
          sortAccessor: (r) => r.policy_types.join(','),
          render: (r) => <ChipList values={r.policy_types} />,
        },
        {
          key: 'pod_selector',
          header: 'Pod Selector',
          width: 280,
          sortAccessor: (r) => r.pod_selector,
          render: (r) => (
            <span className="font-mono text-[12px] text-secondary">{r.pod_selector}</span>
          ),
        },
        {
          key: 'ingress_rules',
          header: 'Ingress',
          width: 90,
          sortAccessor: (r) => r.ingress_rules,
          render: (r) => r.ingress_rules,
        },
        {
          key: 'egress_rules',
          header: 'Egress',
          width: 90,
          sortAccessor: (r) => r.egress_rules,
          render: (r) => r.egress_rules,
        },
      ]}
    />
  )
}
