import * as k8s from '@kubernetes/client-node'
import yaml from 'js-yaml'

import { getClients, withAuthRetry } from './client'
import { is404 } from './errors'

export function getResourceYaml(
  context: string,
  kind: string,
  namespace: string | null,
  name: string,
  apiVersion?: string,
  plural?: string,
) {
  return withAuthRetry(context, async () => {
    const {
      coreApi,
      appsApi,
      batchApi,
      networkingApi,
      discoveryApi,
      storageApi,
      rbacApi,
      apiextensionsApi,
      customObjectsApi,
    } = getClients(context)
    let obj: unknown

    switch (kind) {
      case 'Pod':
        obj = await coreApi.readNamespacedPod({ name, namespace: namespace! })
        break
      case 'Deployment':
        obj = await appsApi.readNamespacedDeployment({
          name,
          namespace: namespace!,
        })
        break
      case 'Service':
        obj = await coreApi.readNamespacedService({
          name,
          namespace: namespace!,
        })
        break
      case 'Node':
        obj = await coreApi.readNode({ name })
        break
      case 'ReplicaSet':
        obj = await appsApi.readNamespacedReplicaSet({ name, namespace: namespace! })
        break
      case 'StatefulSet':
        obj = await appsApi.readNamespacedStatefulSet({ name, namespace: namespace! })
        break
      case 'DaemonSet':
        obj = await appsApi.readNamespacedDaemonSet({ name, namespace: namespace! })
        break
      case 'Job':
        obj = await batchApi.readNamespacedJob({ name, namespace: namespace! })
        break
      case 'CronJob': {
        const api = batchApi as unknown as {
          readNamespacedCronJob: (args: { name: string; namespace: string }) => Promise<unknown>
        }

        obj = await api.readNamespacedCronJob({ name, namespace: namespace! })
        break
      }
      case 'Ingress':
        obj = await networkingApi.readNamespacedIngress({ name, namespace: namespace! })
        break
      case 'NetworkPolicy': {
        const api = networkingApi as unknown as {
          readNamespacedNetworkPolicy: (args: {
            name: string
            namespace: string
          }) => Promise<unknown>
        }

        obj = await api.readNamespacedNetworkPolicy({ name, namespace: namespace! })
        break
      }
      case 'EndpointSlice':
        obj = await discoveryApi.readNamespacedEndpointSlice({ name, namespace: namespace! })
        break
      case 'ConfigMap':
        obj = await coreApi.readNamespacedConfigMap({ name, namespace: namespace! })
        break
      case 'Secret':
        obj = await coreApi.readNamespacedSecret({ name, namespace: namespace! })
        break
      case 'ServiceAccount':
        obj = await coreApi.readNamespacedServiceAccount({ name, namespace: namespace! })
        break
      case 'Role':
        obj = await rbacApi.readNamespacedRole({ name, namespace: namespace! })
        break
      case 'RoleBinding':
        obj = await rbacApi.readNamespacedRoleBinding({ name, namespace: namespace! })
        break
      case 'ClusterRole':
        obj = await rbacApi.readClusterRole({ name })
        break
      case 'ClusterRoleBinding':
        obj = await rbacApi.readClusterRoleBinding({ name })
        break
      case 'StorageClass':
        obj = await storageApi.readStorageClass({ name })
        break
      case 'PersistentVolume':
        obj = await coreApi.readPersistentVolume({ name })
        break
      case 'PersistentVolumeClaim':
        obj = await coreApi.readNamespacedPersistentVolumeClaim({ name, namespace: namespace! })
        break
      case 'CustomResourceDefinition':
        obj = await apiextensionsApi.readCustomResourceDefinition({ name })
        break
      case 'HelmRelease': {
        // `name` is the storage object name (`sh.helm.release.v1.<release>.vN`)
        // so revisions remain addressable in the detail view.
        try {
          obj = await coreApi.readNamespacedSecret({ name, namespace: namespace! })
        } catch (err) {
          if (!is404(err)) throw err
          obj = await coreApi.readNamespacedConfigMap({ name, namespace: namespace! })
        }
        break
      }
      case 'CustomResource': {
        if (!apiVersion || !plural) {
          throw new Error('CustomResource detail requires apiVersion and plural')
        }
        const [group, version] = apiVersion.split('/', 2)

        if (!group || !version) {
          throw new Error(`Invalid custom resource API version: ${apiVersion}`)
        }
        obj = namespace
          ? await customObjectsApi.getNamespacedCustomObject({
              group,
              version,
              plural,
              name,
              namespace,
            })
          : await customObjectsApi.getClusterCustomObject({ group, version, plural, name })
        break
      }
      default:
        throw new Error(`Unsupported kind: ${kind}`)
    }

    return yaml.dump(obj, { skipInvalid: true })
  })
}

export type ApplyResourceIdentity = {
  apiVersion: string
  kind: string
  name: string
  namespace: string | null
}

export function applyResourceYaml(
  context: string,
  yamlText: string,
  expected: ApplyResourceIdentity,
) {
  return withAuthRetry(context, async () => {
    const doc = yaml.load(yamlText) as k8s.KubernetesObject | null

    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
      throw new Error('YAML must contain a single Kubernetes object.')
    }
    if (!doc.apiVersion || !doc.kind || !doc.metadata?.name) {
      throw new Error('YAML must include apiVersion, kind, and metadata.name.')
    }
    const actualNamespace = doc.metadata.namespace ?? expected.namespace ?? null

    if (
      doc.apiVersion !== expected.apiVersion ||
      doc.kind !== expected.kind ||
      doc.metadata.name !== expected.name ||
      actualNamespace !== expected.namespace
    ) {
      const namespacePrefix = expected.namespace ? `${expected.namespace}/` : ''

      throw new Error(
        `YAML identity does not match the open resource. Expected ${expected.apiVersion} ${expected.kind} ` +
          `${namespacePrefix}${expected.name}.`,
      )
    }
    if (expected.namespace !== null) {
      doc.metadata = doc.metadata ?? {}
      doc.metadata.namespace = expected.namespace
    }
    const { kc } = getClients(context)
    const objectApi = k8s.KubernetesObjectApi.makeApiClient(kc)

    await objectApi.patch(
      doc,
      undefined,
      undefined,
      'atlas',
      false,
      k8s.PatchStrategy.ServerSideApply,
    )
  })
}
