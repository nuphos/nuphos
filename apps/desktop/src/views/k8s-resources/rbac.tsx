import { api } from '../../api'

import {
  clusterRoleBindingDeleteTarget,
  clusterRoleDeleteTarget,
  includes,
  roleBindingDeleteTarget,
  roleDeleteTarget,
  serviceAccountDeleteTarget,
} from './shared'
import { ClusterTable, NamespacedTable } from './tables'
import { ChipList } from './ui'

import type { BaseProps, NamespacedProps } from './shared'
import type {
  ClusterRoleBindingItem,
  ClusterRoleItem,
  RoleBindingItem,
  RoleItem,
  ServiceAccountItem,
} from '../../types'

export function ServiceAccountsView(props: NamespacedProps<ServiceAccountItem>) {
  return (
    <NamespacedTable
      {...props}
      loader={api.listServiceAccounts}
      storageKey="service-accounts"
      deleteTarget={serviceAccountDeleteTarget}
      columns={[
        {
          key: 'secrets',
          header: 'Secrets',
          width: 90,
          sortAccessor: (r) => r.secrets,
          render: (r) => r.secrets,
        },
        {
          key: 'image_pull_secrets',
          header: 'Image Pull',
          width: 110,
          sortAccessor: (r) => r.image_pull_secrets,
          render: (r) => r.image_pull_secrets,
        },
      ]}
    />
  )
}

export function RolesView(props: NamespacedProps<RoleItem>) {
  return (
    <NamespacedTable
      {...props}
      loader={api.listRoles}
      storageKey="roles"
      deleteTarget={roleDeleteTarget}
      matches={(r, f) =>
        includes(r.name, f) || includes(r.namespace, f) || includes(r.rule_summaries, f)
      }
      columns={[
        {
          key: 'rules',
          header: 'Rules',
          width: 80,
          sortAccessor: (r) => r.rules,
          render: (r) => r.rules,
        },
        {
          key: 'rule_summaries',
          header: 'Rules (target: verbs)',
          width: 520,
          sortAccessor: (r) => r.rule_summaries.join(','),
          render: (r) => <ChipList values={r.rule_summaries} />,
        },
      ]}
    />
  )
}

export function RoleBindingsView(props: NamespacedProps<RoleBindingItem>) {
  return (
    <NamespacedTable
      {...props}
      loader={api.listRoleBindings}
      storageKey="role-bindings"
      deleteTarget={roleBindingDeleteTarget}
      matches={(r, f) =>
        includes(r.name, f) ||
        includes(r.namespace, f) ||
        includes(r.role_ref, f) ||
        includes(r.subjects, f)
      }
      columns={[
        {
          key: 'role_ref',
          header: 'Role Ref',
          width: 240,
          sortAccessor: (r) => r.role_ref,
          render: (r) => (
            <span className="font-mono text-[12px] text-secondary">{r.role_ref || '-'}</span>
          ),
        },
        {
          key: 'subjects',
          header: 'Subjects',
          width: 360,
          sortAccessor: (r) => r.subjects.join(','),
          render: (r) => <ChipList values={r.subjects} />,
        },
      ]}
    />
  )
}

export function ClusterRolesView(props: BaseProps<ClusterRoleItem>) {
  return (
    <ClusterTable
      {...props}
      loader={api.listClusterRoles}
      storageKey="cluster-roles"
      deleteTarget={clusterRoleDeleteTarget}
      matches={(r, f) => includes(r.name, f) || includes(r.rule_summaries, f)}
      columns={[
        {
          key: 'rules',
          header: 'Rules',
          width: 80,
          sortAccessor: (r) => r.rules,
          render: (r) => r.rules,
        },
        {
          key: 'rule_summaries',
          header: 'Rules (target: verbs)',
          width: 580,
          sortAccessor: (r) => r.rule_summaries.join(','),
          render: (r) => <ChipList values={r.rule_summaries} />,
        },
      ]}
    />
  )
}

export function ClusterRoleBindingsView(props: BaseProps<ClusterRoleBindingItem>) {
  return (
    <ClusterTable
      {...props}
      loader={api.listClusterRoleBindings}
      storageKey="cluster-role-bindings"
      deleteTarget={clusterRoleBindingDeleteTarget}
      matches={(r, f) => includes(r.name, f) || includes(r.role_ref, f) || includes(r.subjects, f)}
      columns={[
        {
          key: 'role_ref',
          header: 'Role Ref',
          width: 260,
          sortAccessor: (r) => r.role_ref,
          render: (r) => (
            <span className="font-mono text-[12px] text-secondary">{r.role_ref || '-'}</span>
          ),
        },
        {
          key: 'subjects',
          header: 'Subjects',
          width: 420,
          sortAccessor: (r) => r.subjects.join(','),
          render: (r) => <ChipList values={r.subjects} />,
        },
      ]}
    />
  )
}
