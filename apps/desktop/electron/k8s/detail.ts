import { podContainerDetails } from '../podContainerDetail'

import { getClients, withAuthRetry } from './client'
import { podPortOptions } from './port-forward-options'
import { podStatusSummary } from './pod-status'
import { nodeMetricsToUsageMap } from './rows-nodes'
import { effectivePodResources, mapPodRow, podMetricsToUsageMap } from './rows-pods'
import { ageOf, parseCpu, parseMemory } from './utils'

import type { PodUsage } from './rows-pods'
import type { PodDetail } from '../../src/types'
import type * as k8s from '@kubernetes/client-node'

export function getPodDetail(context: string, namespace: string, name: string) {
  return withAuthRetry(context, async () => {
    const { coreApi } = getClients(context)
    const pod = await coreApi.readNamespacedPod({ name, namespace })

    const spec = pod.spec ?? ({} as k8s.V1PodSpec)
    const status = pod.status ?? {}

    const { containers, init_containers, ephemeral_containers } = podContainerDetails(spec, status)

    const conditions = (status.conditions ?? [])
      .map((condition) => ({
        type: condition.type,
        status: condition.status,
        reason: condition.reason ?? null,
        message: condition.message ?? null,
      }))
      .sort((a, b) => a.type.localeCompare(b.type))

    const tolerations = (spec.tolerations ?? []).map((t) => ({
      key: t.key ?? 'All Taints',
      effect: t.effect ?? 'All',
      operator: t.operator ?? null,
      value: t.value ?? null,
    }))

    const owner = (pod.metadata?.ownerReferences ?? [])[0]

    const detail: PodDetail = {
      namespace: pod.metadata?.namespace ?? '',
      name: pod.metadata?.name ?? '',
      ports: podPortOptions(pod),
      ...podStatusSummary(pod),
      phase: status.phase ?? 'Unknown',
      node: spec.nodeName ?? null,
      pod_ip: status.podIP ?? null,
      host_ip: status.hostIP ?? null,
      qos: status.qosClass ?? null,
      service_account: spec.serviceAccountName ?? null,
      age: ageOf(pod.metadata?.creationTimestamp),
      start_time: ageOf(status.startTime),
      labels: Object.entries(pod.metadata?.labels ?? {}),
      annotations: Object.entries(pod.metadata?.annotations ?? {}),
      conditions,
      tolerations,
      containers,
      init_containers,
      ephemeral_containers,
      owner_kind: owner?.kind ?? null,
      owner_name: owner?.name ?? null,
    }

    return detail
  })
}

// Returns a structurally-typed object; the renderer's `NodeDetail`
// (src/types.ts) is the single source of truth for this IPC contract, the same
// convention getPodDetail follows. Entries are sorted by key for stable display
// (the node object's map order is not guaranteed across reads).
export function getNodeDetail(context: string, name: string) {
  return withAuthRetry(context, async () => {
    const { coreApi, metricsClient: metrics } = getClients(context)
    // Pods are fetched server-side filtered to this node (cheap even on big
    // clusters); usage and pod-list tolerate failure (metrics-server / RBAC).
    const [node, podsRes, nodeUsage, podUsage] = await Promise.all([
      coreApi.readNode({ name }),
      coreApi.listPodForAllNamespaces({ fieldSelector: `spec.nodeName=${name}` }).catch(() => null),
      metrics
        .getNodeMetrics()
        .then((res) => nodeMetricsToUsageMap(res).get(name) ?? null)
        .catch(() => null),
      // Per-pod usage for the Scheduled Pods table. The metrics API can't filter
      // by node, so fetch all and look up by key; tolerate metrics-server gaps.
      metrics
        .getPodMetrics()
        .then((res) => podMetricsToUsageMap(res))
        .catch(() => new Map<string, PodUsage>()),
    ])

    const info = node.status?.nodeInfo
    const addresses = node.status?.addresses ?? []
    const addr = (type: string) => addresses.find((a) => a.type === type)?.address ?? null

    const labels = node.metadata?.labels ?? {}
    const roles: string[] = []

    for (const key of Object.keys(labels)) {
      if (key.startsWith('node-role.kubernetes.io/')) {
        roles.push(key.slice('node-role.kubernetes.io/'.length))
      }
    }

    const conds = node.status?.conditions ?? []
    const ready = conds.find((c) => c.type === 'Ready')
    const status = ready?.status === 'True' ? 'Ready' : ready ? 'NotReady' : 'Unknown'

    const byKey = (a: [string, string], b: [string, string]) => a[0].localeCompare(b[0])

    // --- Utilization aggregates ------------------------------------------
    const roundMem = (b: number) => Math.round(b / (1024 * 1024)) * 1024 * 1024
    const capacity = node.status?.capacity ?? {}
    const allocatable = node.status?.allocatable ?? {}
    const qty = (
      m: Record<string, string>,
      key: string,
      parse: (s: string) => number,
    ): number | null => {
      const v = m[key]

      return v ? parse(v) : null
    }

    // Sum pod requests/limits over pods scheduled on this node (skip terminal
    // pods, matching aggregatePodRequestsByNode). `declared` tracks whether any
    // pod contributed so an all-unset cluster reads as null, not 0.
    let cpuReq = 0,
      memReq = 0,
      cpuLim = 0,
      memLim = 0
    let cpuReqSet = false,
      memReqSet = false,
      cpuLimSet = false,
      memLimSet = false

    for (const pod of podsRes?.items ?? []) {
      const phase = pod.status?.phase

      if (phase === 'Succeeded' || phase === 'Failed') continue
      const r = effectivePodResources(pod)

      if (r.cpu_request != null) {
        cpuReq += r.cpu_request
        cpuReqSet = true
      }
      if (r.memory_request != null) {
        memReq += r.memory_request
        memReqSet = true
      }
      if (r.cpu_limit != null) {
        cpuLim += r.cpu_limit
        cpuLimSet = true
      }
      if (r.memory_limit != null) {
        memLim += r.memory_limit
        memLimSet = true
      }
    }

    // null (not []) when the pod list itself failed (RBAC / transient) so the
    // panel can show "Unavailable" instead of a misleading "no pods scheduled".
    const scheduledPods = podsRes
      ? podsRes.items.map((p) =>
          mapPodRow(
            p,
            podUsage.get(`${p.metadata?.namespace ?? ''}/${p.metadata?.name ?? ''}`) ?? null,
          ),
        )
      : null
    const podsCapacityRaw = Number.parseInt(allocatable.pods ?? '0', 10)
    const podsCapacity =
      Number.isFinite(podsCapacityRaw) && podsCapacityRaw > 0 ? podsCapacityRaw : null

    const utilization = {
      cpu: {
        usage: nodeUsage ? Math.round(nodeUsage.cpu) : null,
        capacity: qty(capacity, 'cpu', parseCpu),
        allocatable: qty(allocatable, 'cpu', parseCpu),
        requests: cpuReqSet ? Math.round(cpuReq) : null,
        limits: cpuLimSet ? Math.round(cpuLim) : null,
      },
      memory: {
        usage: nodeUsage ? roundMem(nodeUsage.memory) : null,
        capacity: qty(capacity, 'memory', parseMemory),
        allocatable: qty(allocatable, 'memory', parseMemory),
        requests: memReqSet ? roundMem(memReq) : null,
        limits: memLimSet ? roundMem(memLim) : null,
      },
    }

    return {
      name: node.metadata?.name ?? '',
      status,
      age: ageOf(node.metadata?.creationTimestamp),
      os_image: info?.osImage ?? null,
      kernel_version: info?.kernelVersion ?? null,
      kubelet_version: info?.kubeletVersion ?? null,
      kube_proxy_version: info?.kubeProxyVersion ?? null,
      hostname: addr('Hostname'),
      internal_ip: addr('InternalIP'),
      external_ip: addr('ExternalIP'),
      roles: roles.toSorted((a, b) => a.localeCompare(b)),
      taints: (node.spec?.taints ?? [])
        .map((t) => ({ key: t.key, value: t.value ?? null, effect: t.effect }))
        .sort((a, b) => a.key.localeCompare(b.key)),
      conditions: conds
        .map((c) => ({ type: c.type, status: c.status }))
        .sort((a, b) => a.type.localeCompare(b.type)),
      labels: Object.entries(labels).sort(byKey),
      annotations: Object.entries(node.metadata?.annotations ?? {}).sort(byKey),
      schedulable: !node.spec?.unschedulable,
      utilization,
      scheduled_pods: scheduledPods,
      pods_capacity: podsCapacity,
    }
  })
}
