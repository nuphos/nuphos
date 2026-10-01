import { Trash2 } from 'lucide-react'

import { api } from '../../api'

import type { ContextMenuItem } from '../../components/ContextMenu'
import type {
  ClusterRoleBindingItem,
  ClusterRoleItem,
  CronJobItem,
  CustomResourceDefinitionItem,
  HelmReleaseItem,
  NetworkPolicyItem,
  PersistentVolumeClaimItem,
  PersistentVolumeItem,
  RoleBindingItem,
  RoleItem,
  ServiceAccountItem,
} from '../../types'

export type BaseProps<T> = {
  filter: string
  refreshKey: number
  onSelect: (row: T) => void
  onCount: (n: number) => void
  onLoading?: (loading: boolean) => void
}

export type NamespacedProps<T> = BaseProps<T> & {
  namespace: string
}

export type DeleteTarget = {
  kind: string
  namespace: string | null
  name: string
  apiVersion?: string
}

export type RowActionFactory<T> = (row: T, context: string) => ContextMenuItem[]

export const cronJobDeleteTarget = (r: CronJobItem): DeleteTarget => ({
  kind: 'CronJob',
  namespace: r.namespace,
  name: r.name,
})

export const networkPolicyDeleteTarget = (r: NetworkPolicyItem): DeleteTarget => ({
  kind: 'NetworkPolicy',
  namespace: r.namespace,
  name: r.name,
})

export const serviceAccountDeleteTarget = (r: ServiceAccountItem): DeleteTarget => ({
  kind: 'ServiceAccount',
  namespace: r.namespace,
  name: r.name,
})

export const roleDeleteTarget = (r: RoleItem): DeleteTarget => ({
  kind: 'Role',
  namespace: r.namespace,
  name: r.name,
})

export const roleBindingDeleteTarget = (r: RoleBindingItem): DeleteTarget => ({
  kind: 'RoleBinding',
  namespace: r.namespace,
  name: r.name,
})

export const clusterRoleDeleteTarget = (r: ClusterRoleItem): DeleteTarget => ({
  kind: 'ClusterRole',
  namespace: null,
  name: r.name,
})

export const clusterRoleBindingDeleteTarget = (r: ClusterRoleBindingItem): DeleteTarget => ({
  kind: 'ClusterRoleBinding',
  namespace: null,
  name: r.name,
})

export const persistentVolumeDeleteTarget = (r: PersistentVolumeItem): DeleteTarget => ({
  kind: 'PersistentVolume',
  namespace: null,
  name: r.name,
})

export const persistentVolumeClaimDeleteTarget = (r: PersistentVolumeClaimItem): DeleteTarget => ({
  kind: 'PersistentVolumeClaim',
  namespace: r.namespace,
  name: r.name,
})

export const crdDeleteTarget = (r: CustomResourceDefinitionItem): DeleteTarget => ({
  kind: 'CustomResourceDefinition',
  namespace: null,
  name: r.name,
})

export const helmReleaseActions: RowActionFactory<HelmReleaseItem> = (release, context) => [
  {
    key: 'uninstall-helm-release',
    label: 'Uninstall Helm release',
    icon: Trash2,
    destructive: true,
    confirm: `Uninstall Helm release "${release.namespace}/${release.name}"? This will remove the resources managed by this release.`,
    onSelect: async () => {
      await api.uninstallHelmRelease(context, release.namespace, release.name)
    },
  },
]

export function includes(haystack: unknown, needle: string): boolean {
  if (!needle) return true
  if (Array.isArray(haystack)) return haystack.some((v) => includes(v, needle))
  if (typeof haystack === 'string') return haystack.toLowerCase().includes(needle)
  if (typeof haystack === 'number' || typeof haystack === 'boolean') {
    return String(haystack).toLowerCase().includes(needle)
  }

  return false
}
