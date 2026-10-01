import { getClients, withAuthRetry } from './client'
import {
  mapConfigMapRow,
  mapPersistentVolumeClaimRow,
  mapPersistentVolumeRow,
  mapSecretRow,
  mapStorageClassRow,
} from './rows-config'
import { mapEndpointSliceRow, mapIngressRow, mapNetworkPolicyRow } from './rows-network'
import {
  mapClusterRoleBindingRow,
  mapClusterRoleRow,
  mapBindingLike,
  mapRoleLike,
  mapServiceAccountRow,
} from './rows-rbac'

import type * as k8s from '@kubernetes/client-node'

export function listIngresses(context: string, namespace: string | null) {
  return withAuthRetry(context, async () => {
    const { networkingApi } = getClients(context)
    const res = namespace
      ? await networkingApi.listNamespacedIngress({ namespace })
      : await networkingApi.listIngressForAllNamespaces()

    return res.items.map(mapIngressRow)
  })
}

export function listNetworkPolicies(context: string, namespace: string | null) {
  return withAuthRetry(context, async () => {
    const { networkingApi } = getClients(context)
    const api = networkingApi as unknown as {
      listNamespacedNetworkPolicy: (args: {
        namespace: string
      }) => Promise<{ items: k8s.V1NetworkPolicy[] }>
      listNetworkPolicyForAllNamespaces: () => Promise<{ items: k8s.V1NetworkPolicy[] }>
    }
    const res = namespace
      ? await api.listNamespacedNetworkPolicy({ namespace })
      : await api.listNetworkPolicyForAllNamespaces()

    return res.items.map(mapNetworkPolicyRow)
  })
}

export function listEndpointSlices(context: string, namespace: string | null) {
  return withAuthRetry(context, async () => {
    const { discoveryApi } = getClients(context)
    const res = namespace
      ? await discoveryApi.listNamespacedEndpointSlice({ namespace })
      : await discoveryApi.listEndpointSliceForAllNamespaces()

    return res.items.map(mapEndpointSliceRow)
  })
}

export function listConfigMaps(context: string, namespace: string | null) {
  return withAuthRetry(context, async () => {
    const { coreApi } = getClients(context)
    const res = namespace
      ? await coreApi.listNamespacedConfigMap({ namespace })
      : await coreApi.listConfigMapForAllNamespaces()

    return res.items.map(mapConfigMapRow)
  })
}

export function listSecrets(context: string, namespace: string | null) {
  return withAuthRetry(context, async () => {
    const { coreApi } = getClients(context)
    const res = namespace
      ? await coreApi.listNamespacedSecret({ namespace })
      : await coreApi.listSecretForAllNamespaces()

    return res.items.map(mapSecretRow)
  })
}

export function listStorageClasses(context: string) {
  return withAuthRetry(context, async () => {
    const { storageApi } = getClients(context)
    const res = await storageApi.listStorageClass()

    return res.items.map(mapStorageClassRow)
  })
}

export function listServiceAccounts(context: string, namespace: string | null) {
  return withAuthRetry(context, async () => {
    const { coreApi } = getClients(context)
    const res = namespace
      ? await coreApi.listNamespacedServiceAccount({ namespace })
      : await coreApi.listServiceAccountForAllNamespaces()

    return res.items.map(mapServiceAccountRow)
  })
}

export function listRoles(context: string, namespace: string | null) {
  return withAuthRetry(context, async () => {
    const { rbacApi } = getClients(context)
    const res = namespace
      ? await rbacApi.listNamespacedRole({ namespace })
      : await rbacApi.listRoleForAllNamespaces()

    return res.items.map(mapRoleLike)
  })
}

export function listRoleBindings(context: string, namespace: string | null) {
  return withAuthRetry(context, async () => {
    const { rbacApi } = getClients(context)
    const res = namespace
      ? await rbacApi.listNamespacedRoleBinding({ namespace })
      : await rbacApi.listRoleBindingForAllNamespaces()

    return res.items.map(mapBindingLike)
  })
}

export function listClusterRoles(context: string) {
  return withAuthRetry(context, async () => {
    const { rbacApi } = getClients(context)
    const res = await rbacApi.listClusterRole()

    return res.items.map(mapClusterRoleRow)
  })
}

export function listClusterRoleBindings(context: string) {
  return withAuthRetry(context, async () => {
    const { rbacApi } = getClients(context)
    const res = await rbacApi.listClusterRoleBinding()

    return res.items.map(mapClusterRoleBindingRow)
  })
}

export function listPersistentVolumes(context: string) {
  return withAuthRetry(context, async () => {
    const { coreApi } = getClients(context)
    const res = await coreApi.listPersistentVolume()

    return res.items.map(mapPersistentVolumeRow)
  })
}

export function listPersistentVolumeClaims(context: string, namespace: string | null) {
  return withAuthRetry(context, async () => {
    const { coreApi } = getClients(context)
    const res = namespace
      ? await coreApi.listNamespacedPersistentVolumeClaim({ namespace })
      : await coreApi.listPersistentVolumeClaimForAllNamespaces()

    return res.items.map(mapPersistentVolumeClaimRow)
  })
}
