import {
  getAppsApi,
  getBatchApi,
  mapDaemonSetRow,
  mapDeploymentRow,
  mapJobRow,
  mapReplicaSetRow,
  mapStatefulSetRow,
} from './k8s'
import { getWorkloadResourcesFor } from './k8s-metrics'
import { defaultKeyFromObject } from './k8s-watch-shared'

import type { WatchRegistryEntry } from './k8s-watch-shared'
import type * as k8s from '@kubernetes/client-node'

export const WORKLOAD_REGISTRY: Record<
  'Deployment' | 'ReplicaSet' | 'StatefulSet' | 'DaemonSet' | 'Job',
  WatchRegistryEntry
> = {
  Deployment: {
    listPath: (ns) =>
      ns ? `/apis/apps/v1/namespaces/${ns}/deployments` : '/apis/apps/v1/deployments',
    listFn: (context, ns) => async () => {
      const api = getAppsApi(context)

      return ns
        ? await api.listNamespacedDeployment({
            namespace: ns,
          })
        : await api.listDeploymentForAllNamespaces()
    },
    mapRow: (obj, scope) => {
      const d = obj as k8s.V1Deployment
      const rowKey = defaultKeyFromObject(d)
      const resources = getWorkloadResourcesFor(scope.context, 'Deployment', rowKey)

      return mapDeploymentRow(d, resources)
    },
    keyOf: defaultKeyFromObject,
    needsMetrics: true,
  },
  ReplicaSet: {
    listPath: (ns) =>
      ns ? `/apis/apps/v1/namespaces/${ns}/replicasets` : '/apis/apps/v1/replicasets',
    listFn: (context, ns) => async () => {
      const api = getAppsApi(context)

      return ns
        ? await api.listNamespacedReplicaSet({
            namespace: ns,
          })
        : await api.listReplicaSetForAllNamespaces()
    },
    mapRow: (obj, scope) => {
      const r = obj as k8s.V1ReplicaSet
      const rowKey = defaultKeyFromObject(r)
      const resources = getWorkloadResourcesFor(scope.context, 'ReplicaSet', rowKey)

      return mapReplicaSetRow(r, resources)
    },
    keyOf: defaultKeyFromObject,
    needsMetrics: true,
  },
  StatefulSet: {
    listPath: (ns) =>
      ns ? `/apis/apps/v1/namespaces/${ns}/statefulsets` : '/apis/apps/v1/statefulsets',
    listFn: (context, ns) => async () => {
      const api = getAppsApi(context)

      return ns
        ? await api.listNamespacedStatefulSet({
            namespace: ns,
          })
        : await api.listStatefulSetForAllNamespaces()
    },
    mapRow: (obj, scope) => {
      const s = obj as k8s.V1StatefulSet
      const rowKey = defaultKeyFromObject(s)
      const resources = getWorkloadResourcesFor(scope.context, 'StatefulSet', rowKey)

      return mapStatefulSetRow(s, resources)
    },
    keyOf: defaultKeyFromObject,
    needsMetrics: true,
  },
  DaemonSet: {
    listPath: (ns) =>
      ns ? `/apis/apps/v1/namespaces/${ns}/daemonsets` : '/apis/apps/v1/daemonsets',
    listFn: (context, ns) => async () => {
      const api = getAppsApi(context)

      return ns
        ? await api.listNamespacedDaemonSet({
            namespace: ns,
          })
        : await api.listDaemonSetForAllNamespaces()
    },
    mapRow: (obj, scope) => {
      const d = obj as k8s.V1DaemonSet
      const rowKey = defaultKeyFromObject(d)
      const resources = getWorkloadResourcesFor(scope.context, 'DaemonSet', rowKey)

      return mapDaemonSetRow(d, resources)
    },
    keyOf: defaultKeyFromObject,
    needsMetrics: true,
  },
  Job: {
    listPath: (ns) => (ns ? `/apis/batch/v1/namespaces/${ns}/jobs` : '/apis/batch/v1/jobs'),
    listFn: (context, ns) => async () => {
      const api = getBatchApi(context)

      return ns
        ? await api.listNamespacedJob({
            namespace: ns,
          })
        : await api.listJobForAllNamespaces()
    },
    mapRow: (obj, scope) => {
      const j = obj as k8s.V1Job
      const rowKey = defaultKeyFromObject(j)
      const resources = getWorkloadResourcesFor(scope.context, 'Job', rowKey)

      return mapJobRow(j, resources)
    },
    keyOf: defaultKeyFromObject,
    needsMetrics: true,
  },
}
