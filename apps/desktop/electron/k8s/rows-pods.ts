import { podStatusSummary } from './pod-status'
import { podPortOptions } from './port-forward-options'
import { ageOf, parseCpu, parseMemory } from './utils'

import type { PortForwardPort } from './port-forward-shared'
import type * as k8s from '@kubernetes/client-node'

export type PodUsage = { cpu: number; memory: number }

export type PodRow = {
  namespace: string
  name: string
  ports: PortForwardPort[]
  ready: string
  status: string
  restarts: number
  // ISO timestamp of the most recent container restart (latest
  // lastState.terminated.finishedAt across containers), or null if none.
  last_restart: string | null
  age: string | null
  node: string | null
  pod_ip: string | null
  cpu: number | null
  memory: number | null
  cpu_request: number | null
  memory_request: number | null
  cpu_limit: number | null
  memory_limit: number | null
  // Carried so the renderer can do client-side selector filtering
  // (workload detail's Pods tab reuses the main Pods view + filters by the
  // workload's selector against this map).
  labels: Record<string, string>
}

// Effective pod resource request matches kube-scheduler: max(sum-of-regular,
// max-of-init) — init containers run sequentially before regulars, so the
// scheduler reserves the larger of the two phases. Memory follows the same
// rule. Returns null when *no* container declares the resource (the bar can
// then hide the requested marker instead of pinning it at zero).
export function effectivePodResources(pod: k8s.V1Pod): {
  cpu_request: number | null
  memory_request: number | null
  cpu_limit: number | null
  memory_limit: number | null
} {
  const regular = pod.spec?.containers ?? []
  const init = pod.spec?.initContainers ?? []

  function sumRegular(field: 'requests' | 'limits', key: 'cpu' | 'memory'): number | null {
    let total = 0
    let declared = 0

    for (const c of regular) {
      const v = c.resources?.[field]?.[key]

      if (v != null) {
        declared++
        total += key === 'cpu' ? parseCpu(v) : parseMemory(v)
      }
    }
    if (declared === 0) return null
    // For limits, every regular container must declare a cap — one
    // unlimited container makes the pod effectively unbounded for that
    // resource. Reporting a sum here would overstate the ceiling.
    if (field === 'limits' && declared !== regular.length) return null

    return total
  }

  function maxInit(field: 'requests' | 'limits', key: 'cpu' | 'memory'): number | null {
    let max = 0
    let declared = 0

    for (const c of init) {
      const v = c.resources?.[field]?.[key]

      if (v != null) {
        declared++
        const parsed = key === 'cpu' ? parseCpu(v) : parseMemory(v)

        if (parsed > max) max = parsed
      }
    }
    if (declared === 0) return null
    if (field === 'limits' && declared !== init.length) return null

    return max
  }

  function effective(field: 'requests' | 'limits', key: 'cpu' | 'memory'): number | null {
    const r = sumRegular(field, key)
    const i = maxInit(field, key)

    if (r == null && i == null) return null

    return Math.max(r ?? 0, i ?? 0)
  }

  return {
    cpu_request: effective('requests', 'cpu'),
    memory_request: effective('requests', 'memory'),
    cpu_limit: effective('limits', 'cpu'),
    memory_limit: effective('limits', 'memory'),
  }
}

export function mapPodRow(pod: k8s.V1Pod, usage?: PodUsage | null): PodRow {
  const cs = [
    ...(pod.status?.containerStatuses ?? []),
    ...(pod.status?.initContainerStatuses ?? []),
  ]
  const summary = podStatusSummary(pod)
  const restarts = cs.reduce((acc, c) => acc + (c.restartCount ?? 0), 0)
  let lastRestart: string | null = null

  for (const c of cs) {
    const finished = c.lastState?.terminated?.finishedAt

    if (!finished) continue
    const iso = typeof finished === 'string' ? finished : new Date(finished).toISOString()

    if (!lastRestart || iso > lastRestart) lastRestart = iso
  }
  const resources = effectivePodResources(pod)

  return {
    namespace: pod.metadata?.namespace ?? '',
    name: pod.metadata?.name ?? '',
    ports: podPortOptions(pod),
    ready: summary.ready,
    status: summary.status,
    restarts,
    last_restart: lastRestart,
    age: ageOf(pod.metadata?.creationTimestamp),
    node: pod.spec?.nodeName ?? null,
    pod_ip: pod.status?.podIP ?? null,
    cpu: usage ? Math.round(usage.cpu) : null,
    memory: usage ? Math.round(usage.memory / (1024 * 1024)) * 1024 * 1024 : null,
    cpu_request: resources.cpu_request != null ? Math.round(resources.cpu_request) : null,
    memory_request:
      resources.memory_request != null
        ? Math.round(resources.memory_request / (1024 * 1024)) * 1024 * 1024
        : null,
    cpu_limit: resources.cpu_limit != null ? Math.round(resources.cpu_limit) : null,
    memory_limit:
      resources.memory_limit != null
        ? Math.round(resources.memory_limit / (1024 * 1024)) * 1024 * 1024
        : null,
    labels: pod.metadata?.labels ?? {},
  }
}

export function podMetricsToUsageMap(
  metricsRes: k8s.PodMetricsList | null | undefined,
): Map<string, PodUsage> {
  const usageByKey = new Map<string, PodUsage>()

  if (!metricsRes) return usageByKey
  for (const m of metricsRes.items) {
    const ns = m.metadata?.namespace ?? ''
    const name = m.metadata?.name ?? ''
    const key = `${ns}/${name}`
    let cpu = 0
    let memory = 0

    for (const c of m.containers ?? []) {
      cpu += parseCpu(c.usage?.cpu ?? '0')
      memory += parseMemory(c.usage?.memory ?? '0')
    }
    usageByKey.set(key, { cpu, memory })
  }

  return usageByKey
}
