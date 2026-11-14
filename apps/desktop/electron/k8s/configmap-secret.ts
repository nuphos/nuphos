import { getClients, withAuthRetry } from './client'
import { k8sLib } from './lib'

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
      k8sLib.setHeaderOptions('Content-Type', k8sLib.PatchStrategy.MergePatch),
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
      k8sLib.setHeaderOptions('Content-Type', k8sLib.PatchStrategy.MergePatch),
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
      k8sLib.setHeaderOptions('Content-Type', k8sLib.PatchStrategy.MergePatch),
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
      k8sLib.setHeaderOptions('Content-Type', k8sLib.PatchStrategy.MergePatch),
    )
  })
}
