import { effectivePodResources } from './rows-pods'
import { ageOf, parseCpu, parseMemory } from './utils'

import type * as k8s from '@kubernetes/client-node'

export type NodeUsage = { cpu: number; memory: number }
export type NodeRequests = { cpu: number; memory: number }

export type NodeRow = {
  name: string
  status: string
  roles: string[]
  version: string | null
  internal_ip: string | null
  os_image: string | null
  taints: string[]
  conditions: string[]
  age: string | null
  cpu: number | null
  memory: number | null
  cpu_request: number | null
  memory_request: number | null
  cpu_capacity: number | null
  memory_capacity: number | null
  pods: number | null
  pods_capacity: number | null
  schedulable: boolean
}

function formatNodeTaint(t: k8s.V1Taint): string {
  const key = t.key ?? ''
  const value = t.value ? `=${t.value}` : ''
  const effect = t.effect ? `:${t.effect}` : ''

  return `${key}${value}${effect}` || '-'
}

function nodeConditionRank(c: k8s.V1NodeCondition): number {
  if (c.type === 'Ready') return 0
  if (c.status === 'True') return 1
  if (c.status === 'Unknown') return 2

  return 3
}

function formatNodeCondition(c: k8s.V1NodeCondition): string {
  const type = c.type ?? 'Unknown'
  const status = c.status ?? 'Unknown'

  return `${type}=${status}`
}

export function mapNodeRow(
  n: k8s.V1Node,
  usage?: NodeUsage | null,
  requests?: NodeRequests | null,
  podCount?: number | null,
): NodeRow {
  const labels = n.metadata?.labels ?? {}
  const roles: string[] = []

  for (const key of Object.keys(labels)) {
    if (key.startsWith('node-role.kubernetes.io/')) {
      roles.push(key.slice('node-role.kubernetes.io/'.length))
    }
  }
  const conds = n.status?.conditions ?? []
  const ready = conds.find((c) => c.type === 'Ready')
  const status = ready?.status === 'True' ? 'Ready' : ready ? 'NotReady' : 'Unknown'
  const taints = (n.spec?.taints ?? []).map(formatNodeTaint).sort((a, b) => a.localeCompare(b))
  const conditions = conds
    .slice()
    .sort(
      (a, b) =>
        nodeConditionRank(a) - nodeConditionRank(b) || (a.type ?? '').localeCompare(b.type ?? ''),
    )
    .map(formatNodeCondition)
  const internal = (n.status?.addresses ?? []).find((a) => a.type === 'InternalIP')
  const allocatable = n.status?.allocatable ?? {}
  const cpuCapacity = parseCpu(allocatable.cpu ?? '0')
  const memCapacity = parseMemory(allocatable.memory ?? '0')
  const podsCapacity = Number.parseInt(allocatable.pods ?? '0', 10)

  return {
    name: n.metadata?.name ?? '',
    status,
    roles,
    version: n.status?.nodeInfo?.kubeletVersion ?? null,
    internal_ip: internal?.address ?? null,
    os_image: n.status?.nodeInfo?.osImage ?? null,
    taints,
    conditions,
    age: ageOf(n.metadata?.creationTimestamp),
    cpu: usage ? Math.round(usage.cpu) : null,
    memory: usage ? Math.round(usage.memory / (1024 * 1024)) * 1024 * 1024 : null,
    cpu_request: requests ? Math.round(requests.cpu) : null,
    memory_request: requests ? Math.round(requests.memory / (1024 * 1024)) * 1024 * 1024 : null,
    cpu_capacity: cpuCapacity > 0 ? Math.round(cpuCapacity) : null,
    memory_capacity: memCapacity > 0 ? Math.round(memCapacity / (1024 * 1024)) * 1024 * 1024 : null,
    pods: podCount ?? null,
    pods_capacity: Number.isFinite(podsCapacity) && podsCapacity > 0 ? podsCapacity : null,
    schedulable: !n.spec?.unschedulable,
  }
}

function activeScheduledPodNode(pod: k8s.V1Pod): string | null {
  const node = pod.spec?.nodeName

  if (!node) return null
  const phase = pod.status?.phase

  if (phase === 'Succeeded' || phase === 'Failed') return null

  return node
}

// Group cluster-wide pod resource requests by `spec.nodeName` so the Nodes
// table can show how much of each node's allocatable capacity is already
// reserved by scheduled pods. Same effective-pod-request formula as the Pods
// table to stay consistent.
export function aggregatePodRequestsByNode(
  pods: { items: k8s.V1Pod[] } | k8s.V1PodList | null | undefined,
): Map<string, NodeRequests> {
  const out = new Map<string, NodeRequests>()

  if (!pods) return out
  for (const pod of pods.items) {
    const node = activeScheduledPodNode(pod)

    if (!node) continue
    const r = effectivePodResources(pod)
    const entry = out.get(node) ?? { cpu: 0, memory: 0 }

    if (r.cpu_request != null) entry.cpu += r.cpu_request
    if (r.memory_request != null) entry.memory += r.memory_request
    out.set(node, entry)
  }

  return out
}

export function aggregatePodCountsByNode(
  pods: { items: k8s.V1Pod[] } | k8s.V1PodList | null | undefined,
): Map<string, number> {
  const out = new Map<string, number>()

  if (!pods) return out
  for (const pod of pods.items) {
    const node = activeScheduledPodNode(pod)

    if (!node) continue
    out.set(node, (out.get(node) ?? 0) + 1)
  }

  return out
}

export function nodeMetricsToUsageMap(
  metricsRes: k8s.NodeMetricsList | null | undefined,
): Map<string, NodeUsage> {
  const out = new Map<string, NodeUsage>()

  if (!metricsRes) return out
  for (const m of metricsRes.items) {
    const name = m.metadata?.name ?? ''

    out.set(name, {
      cpu: parseCpu(m.usage?.cpu ?? '0'),
      memory: parseMemory(m.usage?.memory ?? '0'),
    })
  }

  return out
}
