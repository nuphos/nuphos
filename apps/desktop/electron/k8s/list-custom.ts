import { getClients, withAuthRetry } from './client'
import { emptyListOnMissingOrForbidden, is401 } from './errors'
import {
  mapCustomResourceDefinitionRow,
  mapCustomResourceRow,
  mapHelmReleaseRow,
  readableCrdVersion,
} from './rows-custom'
import { runWithConcurrency } from './utils'

import type { ClusterClients } from './client'
import type { CustomResourceRow } from './rows-custom'
import type * as k8s from '@kubernetes/client-node'

export function listHelmReleases(context: string, namespace: string | null) {
  return withAuthRetry(context, async () => {
    const { coreApi } = getClients(context)
    const [secrets, configMaps] = await Promise.all([
      namespace
        ? coreApi
            .listNamespacedSecret({
              namespace,
              labelSelector: 'owner=helm',
            })
            .catch((err: unknown) => emptyListOnMissingOrForbidden<k8s.V1Secret>(err))
        : coreApi
            .listSecretForAllNamespaces({
              labelSelector: 'owner=helm',
            })
            .catch((err: unknown) => emptyListOnMissingOrForbidden<k8s.V1Secret>(err)),
      namespace
        ? coreApi
            .listNamespacedConfigMap({
              namespace,
              labelSelector: 'OWNER=TILLER',
            })
            .catch((err: unknown) => emptyListOnMissingOrForbidden<k8s.V1ConfigMap>(err))
        : coreApi
            .listConfigMapForAllNamespaces({
              labelSelector: 'OWNER=TILLER',
            })
            .catch((err: unknown) => emptyListOnMissingOrForbidden<k8s.V1ConfigMap>(err)),
    ])

    return [
      ...secrets.items
        .filter((s) => s.type === 'helm.sh/release.v1' || s.metadata?.labels?.owner === 'helm')
        .map((s) => mapHelmReleaseRow(s, 'Secret')),
      ...configMaps.items.map((cm) => mapHelmReleaseRow(cm, 'ConfigMap')),
    ].sort(
      (a, b) =>
        a.namespace.localeCompare(b.namespace) ||
        a.name.localeCompare(b.name) ||
        Number(b.revision || 0) - Number(a.revision || 0),
    )
  })
}

export function listCustomResourceDefinitions(context: string) {
  return withAuthRetry(context, async () => {
    const { apiextensionsApi } = getClients(context)
    const res = await apiextensionsApi.listCustomResourceDefinition()

    return res.items.map(mapCustomResourceDefinitionRow)
  })
}

export type CustomResourceDescriptor = {
  apiVersion: string
  kind: string
  plural: string
  namespaced: boolean
}

async function listCustomResource(
  client: ClusterClients['customObjectsApi'],
  resource: CustomResourceDescriptor,
  namespace: string | null,
  bestEffort: boolean,
): Promise<CustomResourceRow[]> {
  const [group, version] = resource.apiVersion.split('/', 2)

  if (!group || !version) {
    throw new Error(`Invalid custom resource API version: ${resource.apiVersion}`)
  }

  try {
    const list =
      resource.namespaced && namespace
        ? await client.listNamespacedCustomObject({
            group,
            version,
            namespace,
            plural: resource.plural,
          })
        : await client.listClusterCustomObject({ group, version, plural: resource.plural })
    const items = (list.items ?? []) as {
      apiVersion?: string
      kind?: string
      metadata?: k8s.V1ObjectMeta
      status?: unknown
    }[]

    return items.map((item) => mapCustomResourceRow(item, resource))
  } catch (err) {
    if (!bestEffort || is401(err)) throw err

    // CRDs often have RBAC gaps or conversion webhooks that fail. Keep the
    // aggregate page useful by showing the resources that can be listed.
    return []
  }
}

export function listCustomResources(context: string, namespace: string | null) {
  return withAuthRetry(context, async () => {
    const { apiextensionsApi, customObjectsApi } = getClients(context)
    const crds = await apiextensionsApi.listCustomResourceDefinition()
    const resources: CustomResourceDescriptor[] = []

    for (const crd of crds.items ?? []) {
      const group = crd.spec?.group
      const plural = crd.spec?.names?.plural
      const kind = crd.spec?.names?.kind
      const version = readableCrdVersion(crd)

      if (!group || !plural || !kind || !version) continue
      const namespaced = crd.spec?.scope === 'Namespaced'

      // A namespace filter can only narrow namespaced resources.
      if (namespace && !namespaced) continue
      resources.push({ apiVersion: `${group}/${version}`, kind, plural, namespaced })
    }
    const rows: CustomResourceRow[] = []

    await runWithConcurrency(resources, 12, async (resource) => {
      for (const row of await listCustomResource(customObjectsApi, resource, namespace, true)) {
        rows.push(row)
      }
    })

    return rows.sort(
      (a, b) =>
        a.kind.localeCompare(b.kind) ||
        (a.namespace ?? '').localeCompare(b.namespace ?? '') ||
        a.name.localeCompare(b.name),
    )
  })
}

/** Lists one CRD type for the type-specific sidebar destination. */
export function listCustomResourceType(
  context: string,
  namespace: string | null,
  resource: CustomResourceDescriptor,
) {
  return withAuthRetry(context, async () => {
    const { customObjectsApi } = getClients(context)
    const rows = await listCustomResource(customObjectsApi, resource, namespace, false)

    return rows.sort(
      (a, b) =>
        (a.namespace ?? '').localeCompare(b.namespace ?? '') || a.name.localeCompare(b.name),
    )
  })
}
