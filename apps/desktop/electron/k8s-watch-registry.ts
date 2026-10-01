import {
  eventRowKey,
  getCoreApi,
  getDiscoveryApi,
  getNetworkingApi,
  getStorageApi,
  mapConfigMapRow,
  mapEndpointSliceRow,
  mapEventRow,
  mapIngressRow,
  mapNodeRow,
  mapPodRow,
  mapSecretRow,
  mapServiceRow,
  mapStorageClassRow,
} from './k8s'
import {
  getNodePodCountFor,
  getNodeRequestsFor,
  getNodeUsageFor,
  getPodUsageFor,
} from './k8s-metrics'
import { WORKLOAD_REGISTRY } from './k8s-watch-registry-workloads'
import { defaultKeyFromObject } from './k8s-watch-shared'

import type { NodeUsage, PodUsage } from './k8s'
import type { WatchKind, WatchRegistryEntry } from './k8s-watch-shared'
import type * as k8s from '@kubernetes/client-node'

// Per-kind config. `listFn` is a factory closed over context + namespace so a
// single REGISTRY entry serves informers for any (context, namespace) pair.
export const REGISTRY: Record<WatchKind, WatchRegistryEntry> = {
  ...WORKLOAD_REGISTRY,
  Pod: {
    listPath: (ns) => (ns ? `/api/v1/namespaces/${ns}/pods` : '/api/v1/pods'),
    listFn: (context, ns) => async () => {
      const api = getCoreApi(context)

      return ns
        ? await api.listNamespacedPod({
            namespace: ns,
          })
        : await api.listPodForAllNamespaces()
    },
    mapRow: (obj, scope) => {
      const pod = obj as k8s.V1Pod
      const rowKey = defaultKeyFromObject(pod)
      // Pull the latest known metrics for this row, so newly-arrived pods immediately
      // surface usage if the metrics poller has already seen them.
      const usage: PodUsage | null = getPodUsageFor(scope.context, rowKey) ?? null

      return mapPodRow(pod, usage)
    },
    keyOf: defaultKeyFromObject,
    needsMetrics: true,
  },
  Event: {
    listPath: (ns) => (ns ? `/api/v1/namespaces/${ns}/events` : '/api/v1/events'),
    listFn: (context, ns) => async () => {
      const api = getCoreApi(context)

      return ns
        ? await api.listNamespacedEvent({
            namespace: ns,
          })
        : await api.listEventForAllNamespaces()
    },
    mapRow: (obj) => mapEventRow(obj as k8s.CoreV1Event),
    keyOf: (obj) => eventRowKey(obj as k8s.CoreV1Event),
    needsMetrics: false,
  },
  Node: {
    listPath: () => '/api/v1/nodes',
    listFn: (context) => async () => {
      const api = getCoreApi(context)

      return await api.listNode()
    },
    mapRow: (obj, scope) => {
      const n = obj as k8s.V1Node
      const name = n.metadata?.name ?? ''
      const usage: NodeUsage | null = getNodeUsageFor(scope.context, name) ?? null
      const requests = getNodeRequestsFor(scope.context, name)
      const podCount = getNodePodCountFor(scope.context, name)

      return mapNodeRow(n, usage, requests, podCount)
    },
    keyOf: defaultKeyFromObject,
    needsMetrics: true,
  },
  Service: {
    listPath: (ns) => (ns ? `/api/v1/namespaces/${ns}/services` : '/api/v1/services'),
    listFn: (context, ns) => async () => {
      const api = getCoreApi(context)

      return ns
        ? await api.listNamespacedService({
            namespace: ns,
          })
        : await api.listServiceForAllNamespaces()
    },
    mapRow: (obj) => mapServiceRow(obj),
    keyOf: defaultKeyFromObject,
    needsMetrics: false,
  },
  Ingress: {
    listPath: (ns) =>
      ns
        ? `/apis/networking.k8s.io/v1/namespaces/${ns}/ingresses`
        : '/apis/networking.k8s.io/v1/ingresses',
    listFn: (context, ns) => async () => {
      const api = getNetworkingApi(context)

      return ns
        ? await api.listNamespacedIngress({
            namespace: ns,
          })
        : await api.listIngressForAllNamespaces()
    },
    mapRow: (obj) => mapIngressRow(obj),
    keyOf: defaultKeyFromObject,
    needsMetrics: false,
  },
  EndpointSlice: {
    listPath: (ns) =>
      ns
        ? `/apis/discovery.k8s.io/v1/namespaces/${ns}/endpointslices`
        : '/apis/discovery.k8s.io/v1/endpointslices',
    listFn: (context, ns) => async () => {
      const api = getDiscoveryApi(context)

      return ns
        ? await api.listNamespacedEndpointSlice({
            namespace: ns,
          })
        : await api.listEndpointSliceForAllNamespaces()
    },
    mapRow: (obj) => mapEndpointSliceRow(obj as k8s.V1EndpointSlice),
    keyOf: defaultKeyFromObject,
    needsMetrics: false,
  },
  ConfigMap: {
    listPath: (ns) => (ns ? `/api/v1/namespaces/${ns}/configmaps` : '/api/v1/configmaps'),
    listFn: (context, ns) => async () => {
      const api = getCoreApi(context)

      return ns
        ? await api.listNamespacedConfigMap({
            namespace: ns,
          })
        : await api.listConfigMapForAllNamespaces()
    },
    mapRow: (obj) => mapConfigMapRow(obj),
    keyOf: defaultKeyFromObject,
    needsMetrics: false,
  },
  Secret: {
    listPath: (ns) => (ns ? `/api/v1/namespaces/${ns}/secrets` : '/api/v1/secrets'),
    listFn: (context, ns) => async () => {
      const api = getCoreApi(context)

      return ns
        ? await api.listNamespacedSecret({
            namespace: ns,
          })
        : await api.listSecretForAllNamespaces()
    },
    mapRow: (obj) => mapSecretRow(obj),
    keyOf: defaultKeyFromObject,
    needsMetrics: false,
  },
  StorageClass: {
    listPath: () => '/apis/storage.k8s.io/v1/storageclasses',
    listFn: (context) => async () => {
      const api = getStorageApi(context)

      return await api.listStorageClass()
    },
    mapRow: (obj) => mapStorageClassRow(obj as k8s.V1StorageClass),
    keyOf: defaultKeyFromObject,
    needsMetrics: false,
  },
}
