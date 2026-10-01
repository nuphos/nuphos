import * as k8s from '@kubernetes/client-node'

import { getClients, withAuthRetry } from './client'

export function upsertConfigMapKey(
  context: string,
  namespace: string,
  name: string,
  key: string,
  value: string,
  source: 'data' | 'binaryData' = 'data',
) {
  return withAuthRetry(context, async () => {
    const { coreApi } = getClients(context)
    const current = await coreApi.readNamespacedConfigMap({ name, namespace })

    if (current.immutable === true) {
      throw new Error('This ConfigMap is immutable and cannot be edited.')
    }
    await coreApi.patchNamespacedConfigMap(
      {
        name,
        namespace,
        body: { [source]: { [key]: value } },
      },
      k8s.setHeaderOptions('Content-Type', k8s.PatchStrategy.MergePatch),
    )
  })
}

export function removeConfigMapKey(
  context: string,
  namespace: string,
  name: string,
  key: string,
  source: 'data' | 'binaryData',
) {
  return withAuthRetry(context, async () => {
    const { coreApi } = getClients(context)
    const current = await coreApi.readNamespacedConfigMap({ name, namespace })

    if (current.immutable === true) {
      throw new Error('This ConfigMap is immutable and cannot be edited.')
    }
    await coreApi.patchNamespacedConfigMap(
      {
        name,
        namespace,
        body: { [source]: { [key]: null } },
      },
      k8s.setHeaderOptions('Content-Type', k8s.PatchStrategy.MergePatch),
    )
  })
}

export function upsertSecretKey(
  context: string,
  namespace: string,
  name: string,
  key: string,
  value: string,
) {
  return withAuthRetry(context, async () => {
    const { coreApi } = getClients(context)

    await coreApi.patchNamespacedSecret(
      {
        name,
        namespace,
        body: { stringData: { [key]: value } },
      },
      k8s.setHeaderOptions('Content-Type', k8s.PatchStrategy.MergePatch),
    )
  })
}

export function removeSecretKey(context: string, namespace: string, name: string, key: string) {
  return withAuthRetry(context, async () => {
    const { coreApi } = getClients(context)

    await coreApi.patchNamespacedSecret(
      {
        name,
        namespace,
        body: { data: { [key]: null } },
      },
      k8s.setHeaderOptions('Content-Type', k8s.PatchStrategy.MergePatch),
    )
  })
}
