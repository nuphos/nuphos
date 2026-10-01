import { ageOf, uniqueSorted } from './utils'

import type * as k8s from '@kubernetes/client-node'

export type ServiceAccountRow = {
  namespace: string
  name: string
  secrets: number
  image_pull_secrets: number
  age: string | null
}

export function mapServiceAccountRow(sa: k8s.V1ServiceAccount): ServiceAccountRow {
  return {
    namespace: sa.metadata?.namespace ?? '',
    name: sa.metadata?.name ?? '',
    secrets: sa.secrets?.length ?? 0,
    image_pull_secrets: sa.imagePullSecrets?.length ?? 0,
    age: ageOf(sa.metadata?.creationTimestamp),
  }
}

type RbacRule = {
  apiGroups?: string[]
  resources?: string[]
  nonResourceURLs?: string[]
  verbs?: string[]
  resourceNames?: string[]
}

type RbacSubject = {
  kind?: string
  name?: string
  namespace?: string
}

type RoleLike = {
  metadata?: k8s.V1ObjectMeta
  rules?: RbacRule[]
}

type BindingLike = {
  metadata?: k8s.V1ObjectMeta
  roleRef?: { kind?: string; name?: string; apiGroup?: string }
  subjects?: RbacSubject[]
}

export type RoleRow = {
  namespace: string
  name: string
  rules: number
  resources: string[]
  verbs: string[]
  rule_summaries: string[]
  age: string | null
}

export type ClusterRoleRow = Omit<RoleRow, 'namespace'>

export function mapRoleLike(row: RoleLike): RoleRow {
  const rules = row.rules ?? []

  return {
    namespace: row.metadata?.namespace ?? '',
    name: row.metadata?.name ?? '',
    rules: rules.length,
    resources: uniqueSorted(
      rules.flatMap((rule) => [...(rule.resources ?? []), ...(rule.nonResourceURLs ?? [])]),
    ),
    verbs: uniqueSorted(rules.flatMap((r) => r.verbs ?? [])),
    rule_summaries: rules.map((rule) => {
      const targets = rule.resources?.length
        ? `${(rule.apiGroups ?? ['']).map((group) => group || 'core').join(',')}/${rule.resources.join(',')}`
        : (rule.nonResourceURLs ?? []).join(',') || '-'
      const names = rule.resourceNames?.length ? ` [${rule.resourceNames.join(',')}]` : ''

      return `${targets}${names}: ${(rule.verbs ?? []).join(',') || '-'}`
    }),
    age: ageOf(row.metadata?.creationTimestamp),
  }
}

export function mapClusterRoleRow(row: RoleLike): ClusterRoleRow {
  const mapped = mapRoleLike(row)

  return {
    name: mapped.name,
    rules: mapped.rules,
    resources: mapped.resources,
    verbs: mapped.verbs,
    rule_summaries: mapped.rule_summaries,
    age: mapped.age,
  }
}

export type RoleBindingRow = {
  namespace: string
  name: string
  role_ref: string
  subjects: string[]
  age: string | null
}

export type ClusterRoleBindingRow = Omit<RoleBindingRow, 'namespace'>

export function mapBindingLike(row: BindingLike): RoleBindingRow {
  return {
    namespace: row.metadata?.namespace ?? '',
    name: row.metadata?.name ?? '',
    role_ref:
      row.roleRef?.kind && row.roleRef?.name ? `${row.roleRef.kind}/${row.roleRef.name}` : '',
    subjects: (row.subjects ?? []).map((s) =>
      s.namespace
        ? `${s.kind ?? 'Subject'}:${s.namespace}/${s.name ?? ''}`
        : `${s.kind ?? 'Subject'}:${s.name ?? ''}`,
    ),
    age: ageOf(row.metadata?.creationTimestamp),
  }
}

export function mapClusterRoleBindingRow(row: BindingLike): ClusterRoleBindingRow {
  const mapped = mapBindingLike(row)

  return {
    name: mapped.name,
    role_ref: mapped.role_ref,
    subjects: mapped.subjects,
    age: mapped.age,
  }
}
