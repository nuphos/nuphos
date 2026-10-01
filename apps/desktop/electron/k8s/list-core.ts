import { namespacePickerTotals } from '../../src/lib/namespacePickerTotal'

import { getClients, withAuthRetry } from './client'
import { mapServiceRow } from './rows-network'
import {
  aggregatePodCountsByNode,
  aggregatePodRequestsByNode,
  mapNodeRow,
  nodeMetricsToUsageMap,
} from './rows-nodes'
import { mapPodRow, podMetricsToUsageMap } from './rows-pods'
import { aggregateWorkloadResources, mapDeploymentRow, podMatchesSelector } from './rows-workloads'
import { ageOf } from './utils'

// Upper bound for the namespace picker's fetch. A cluster with one namespace
// per environment can have thousands (6000+ observed on a real TKE cluster);
// listing them all is minutes of wall clock and tens of megabytes, and the
// picker only ever renders a couple hundred rows anyway. Fetch one page and
// tell the UI it was truncated so it can say so instead of quietly lying.
const NAMESPACE_PICKER_LIMIT = 500

export type NamespaceNames = {
  names: string[]
  /**
   * Whether the cluster holds more namespaces than `names`. Driven by the
   * continue token alone — the ONLY signal the API guarantees. Kept separate
   * from `total` because a server may report truncation without a count.
   */
  truncated: boolean
  /**
   * The cluster's real namespace count when the server reports it, else null.
   * `remainingItemCount` is explicitly optional in the Kubernetes API
   * conventions (omitted when the server can't cheaply compute it), so it must
   * never be the thing that decides whether the list was truncated.
   */
  total: number | null
}

/**
 * Namespace names only, bounded to one page. For the picker — never for
 * anything that needs the complete set.
 */
export function listNamespaceNames(context: string): Promise<NamespaceNames> {
  return withAuthRetry(context, async () => {
    const { coreApi } = getClients(context)
    const res = await coreApi.listNamespace({ limit: NAMESPACE_PICKER_LIMIT })
    const names = res.items
      .map((ns) => ns.metadata?.name ?? '')
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))

    return {
      names,
      ...namespacePickerTotals({
        fetched: names.length,
        continueToken: res.metadata?._continue,
        remainingItemCount: res.metadata?.remainingItemCount,
      }),
    }
  })
}

export function listNamespaces(context: string) {
  return withAuthRetry(context, async () => {
    const { coreApi } = getClients(context)
    const res = await coreApi.listNamespace()

    return res.items.map((ns) => ({
      name: ns.metadata?.name ?? '',
      status: ns.status?.phase ?? 'Unknown',
      age: ageOf(ns.metadata?.creationTimestamp),
    }))
  })
}

export function listPods(context: string, namespace: string | null) {
  return withAuthRetry(context, async () => {
    const { coreApi, metricsClient: metrics } = getClients(context)
    const [res, metricsRes] = await Promise.all([
      namespace ? coreApi.listNamespacedPod({ namespace }) : coreApi.listPodForAllNamespaces(),
      metrics.getPodMetrics(namespace ?? undefined).catch(() => null),
    ])
    const usageByKey = podMetricsToUsageMap(metricsRes)

    return res.items.map((pod) => {
      const key = `${pod.metadata?.namespace ?? ''}/${pod.metadata?.name ?? ''}`

      return mapPodRow(pod, usageByKey.get(key) ?? null)
    })
  })
}

export function listDeployments(context: string, namespace: string | null) {
  return withAuthRetry(context, async () => {
    const { appsApi, coreApi, metricsClient: metrics } = getClients(context)
    const [res, podsRes, metricsRes] = await Promise.all([
      namespace
        ? appsApi.listNamespacedDeployment({ namespace })
        : appsApi.listDeploymentForAllNamespaces(),
      // Fetching pods in the same scope so we can aggregate per-deployment
      // resources. Tolerate RBAC / metrics-server gaps by falling back to
      // empty data — the row still renders with the deployment metadata.
      namespace
        ? coreApi.listNamespacedPod({ namespace }).catch(() => null)
        : coreApi.listPodForAllNamespaces().catch(() => null),
      metrics.getPodMetrics(namespace ?? undefined).catch(() => null),
    ])
    const allPods = podsRes?.items ?? []
    const usageByKey = podMetricsToUsageMap(metricsRes)

    return res.items.map((d) => {
      const ns = d.metadata?.namespace ?? ''
      const matched = allPods.filter(
        (p) => p.metadata?.namespace === ns && podMatchesSelector(p, d.spec?.selector),
      )

      return mapDeploymentRow(d, aggregateWorkloadResources(matched, usageByKey))
    })
  })
}

export function listNodes(context: string) {
  return withAuthRetry(context, async () => {
    const { coreApi, metricsClient: metrics } = getClients(context)
    const [res, metricsRes, podsRes] = await Promise.all([
      coreApi.listNode(),
      metrics.getNodeMetrics().catch(() => null),
      // Cluster-wide pod list is the source for the requested-capacity bar.
      // Failure here shouldn't break the node list itself, so fall back to an
      // empty aggregation if pods can't be fetched (e.g. RBAC limited).
      coreApi.listPodForAllNamespaces().catch(() => null),
    ])
    const usageByNode = nodeMetricsToUsageMap(metricsRes)
    const requestsByNode = aggregatePodRequestsByNode(podsRes)
    const podCountsByNode = aggregatePodCountsByNode(podsRes)

    return res.items.map((n) => {
      const name = n.metadata?.name ?? ''
      const podCount = podsRes ? (podCountsByNode.get(name) ?? 0) : null

      return mapNodeRow(
        n,
        usageByNode.get(name) ?? null,
        requestsByNode.get(name) ?? null,
        podCount,
      )
    })
  })
}

export function listServices(context: string, namespace: string | null) {
  return withAuthRetry(context, async () => {
    const { coreApi } = getClients(context)
    const res = namespace
      ? await coreApi.listNamespacedService({ namespace })
      : await coreApi.listServiceForAllNamespaces()

    return res.items.map(mapServiceRow)
  })
}
