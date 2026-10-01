import { effectivePodResources } from './rows-pods'
import { ageOf } from './utils'

import type { PodUsage } from './rows-pods'
import type * as k8s from '@kubernetes/client-node'

// Aggregated CPU/memory across the pods matched by a workload selector.
// Field semantics match the per-pod row: usage and request fields are the
// sum when *any* pod declares them, while limit fields require *every* pod
// to declare a limit — partial limits don't bound the workload, so we'd
// rather show "no limit" than understate the ceiling.
export type WorkloadResources = {
  cpu: number | null
  memory: number | null
  cpu_request: number | null
  memory_request: number | null
  cpu_limit: number | null
  memory_limit: number | null
}

export type DeploymentRow = {
  namespace: string
  name: string
  ready: string
  up_to_date: number
  available: number
  age: string | null
  cpu: number | null
  memory: number | null
  cpu_request: number | null
  memory_request: number | null
  cpu_limit: number | null
  memory_limit: number | null
}

export const ZERO_RESOURCES: WorkloadResources = {
  cpu: null,
  memory: null,
  cpu_request: null,
  memory_request: null,
  cpu_limit: null,
  memory_limit: null,
}

export function mapDeploymentRow(
  d: k8s.V1Deployment,
  resources?: WorkloadResources | null,
): DeploymentRow {
  const spec = d.spec?.replicas ?? 0
  const status = d.status ?? {}
  const r = resources ?? ZERO_RESOURCES

  return {
    namespace: d.metadata?.namespace ?? '',
    name: d.metadata?.name ?? '',
    ready: `${String(status.readyReplicas ?? 0)}/${String(spec)}`,
    up_to_date: status.updatedReplicas ?? 0,
    available: status.availableReplicas ?? 0,
    age: ageOf(d.metadata?.creationTimestamp),
    cpu: r.cpu,
    memory: r.memory,
    cpu_request: r.cpu_request,
    memory_request: r.memory_request,
    cpu_limit: r.cpu_limit,
    memory_limit: r.memory_limit,
  }
}

// Label-selector evaluation for matchLabels + matchExpressions, matching
// kube-apimachinery's `Requirement.Matches`:
//   In: key must exist AND value is in the set.
//   NotIn: key may be absent; if present, value must NOT be in the set.
//   Exists/DoesNotExist: presence/absence of the key.
export function podMatchesSelector(
  pod: k8s.V1Pod,
  selector: k8s.V1LabelSelector | undefined,
): boolean {
  if (!selector) return false
  const labels = pod.metadata?.labels ?? {}

  for (const [k, v] of Object.entries(selector.matchLabels ?? {})) {
    if (labels[k] !== v) return false
  }
  for (const expr of selector.matchExpressions ?? []) {
    const val = labels[expr.key]
    const op = expr.operator
    const values = expr.values ?? []

    if (op === 'In' && (val == null || !values.includes(val))) return false
    if (op === 'NotIn' && val != null && values.includes(val)) return false
    if (op === 'Exists' && val == null) return false
    if (op === 'DoesNotExist' && val != null) return false
  }

  return true
}

// Sum pod usage / requests / limits across `pods`. `pods` should already be
// filtered to those owned by the workload (same namespace + selector
// match). Pod-effective resources are computed via the same formula the
// Pods view uses, so a single overcommit-aware definition is shared.
export function aggregateWorkloadResources(
  pods: k8s.V1Pod[],
  usageByKey: Map<string, PodUsage>,
): WorkloadResources {
  if (pods.length === 0) return ZERO_RESOURCES

  let cpuUsage = 0
  let memUsage = 0
  let anyUsage = false

  let cpuReq = 0
  let memReq = 0
  let anyCpuReq = false
  let anyMemReq = false

  let cpuLim = 0
  let memLim = 0
  let allCpuLim = true
  let allMemLim = true

  let activePods = 0

  for (const pod of pods) {
    // Skip pods that no longer consume scheduled resources. This matches
    // the Nodes-side rule so a completed Job doesn't keep counting against
    // its parent Deployment's totals.
    const phase = pod.status?.phase

    if (phase === 'Succeeded' || phase === 'Failed') continue
    activePods++

    const key = `${pod.metadata?.namespace ?? ''}/${pod.metadata?.name ?? ''}`
    const usage = usageByKey.get(key)

    if (usage) {
      cpuUsage += usage.cpu
      memUsage += usage.memory
      anyUsage = true
    }

    const r = effectivePodResources(pod)

    if (r.cpu_request != null) {
      cpuReq += r.cpu_request
      anyCpuReq = true
    }
    if (r.memory_request != null) {
      memReq += r.memory_request
      anyMemReq = true
    }
    if (r.cpu_limit != null) cpuLim += r.cpu_limit
    else allCpuLim = false
    if (r.memory_limit != null) memLim += r.memory_limit
    else allMemLim = false
  }

  // If every matched pod was terminal (e.g. a completed Job), don't
  // emit `0` for the limit fields — that'd render as an explicit zero
  // ceiling. Treat it as "no active pods to aggregate from".
  if (activePods === 0) return ZERO_RESOURCES

  return {
    cpu: anyUsage ? Math.round(cpuUsage) : null,
    memory: anyUsage ? Math.round(memUsage / (1024 * 1024)) * 1024 * 1024 : null,
    cpu_request: anyCpuReq ? Math.round(cpuReq) : null,
    memory_request: anyMemReq ? Math.round(memReq / (1024 * 1024)) * 1024 * 1024 : null,
    cpu_limit: allCpuLim ? Math.round(cpuLim) : null,
    memory_limit: allMemLim ? Math.round(memLim / (1024 * 1024)) * 1024 * 1024 : null,
  }
}
