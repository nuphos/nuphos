import { jobPhase } from './job-status'
import { ZERO_RESOURCES } from './rows-workloads'
import { ageOf } from './utils'

import type { WorkloadResources } from './rows-workloads'
import type * as k8s from '@kubernetes/client-node'

export type ReplicaSetRow = {
  namespace: string
  name: string
  desired: number
  current: number
  ready: number
  age: string | null
  cpu: number | null
  memory: number | null
  cpu_request: number | null
  memory_request: number | null
  cpu_limit: number | null
  memory_limit: number | null
}

export function mapReplicaSetRow(
  r: k8s.V1ReplicaSet,
  resources?: WorkloadResources | null,
): ReplicaSetRow {
  const res = resources ?? ZERO_RESOURCES

  return {
    namespace: r.metadata?.namespace ?? '',
    name: r.metadata?.name ?? '',
    desired: r.spec?.replicas ?? 0,
    current: r.status?.replicas ?? 0,
    ready: r.status?.readyReplicas ?? 0,
    age: ageOf(r.metadata?.creationTimestamp),
    cpu: res.cpu,
    memory: res.memory,
    cpu_request: res.cpu_request,
    memory_request: res.memory_request,
    cpu_limit: res.cpu_limit,
    memory_limit: res.memory_limit,
  }
}

export type StatefulSetRow = {
  namespace: string
  name: string
  ready: string
  service: string
  update_strategy: string
  age: string | null
  cpu: number | null
  memory: number | null
  cpu_request: number | null
  memory_request: number | null
  cpu_limit: number | null
  memory_limit: number | null
}

export function mapStatefulSetRow(
  s: k8s.V1StatefulSet,
  resources?: WorkloadResources | null,
): StatefulSetRow {
  const desired = s.spec?.replicas ?? 0
  const r = resources ?? ZERO_RESOURCES

  return {
    namespace: s.metadata?.namespace ?? '',
    name: s.metadata?.name ?? '',
    ready: `${String(s.status?.readyReplicas ?? 0)}/${String(desired)}`,
    service: s.spec?.serviceName ?? '',
    update_strategy: s.spec?.updateStrategy?.type ?? 'RollingUpdate',
    age: ageOf(s.metadata?.creationTimestamp),
    cpu: r.cpu,
    memory: r.memory,
    cpu_request: r.cpu_request,
    memory_request: r.memory_request,
    cpu_limit: r.cpu_limit,
    memory_limit: r.memory_limit,
  }
}

export type DaemonSetRow = {
  namespace: string
  name: string
  desired: number
  current: number
  ready: number
  available: number
  up_to_date: number
  update_strategy: string
  age: string | null
  cpu: number | null
  memory: number | null
  cpu_request: number | null
  memory_request: number | null
  cpu_limit: number | null
  memory_limit: number | null
}

export function mapDaemonSetRow(
  d: k8s.V1DaemonSet,
  resources?: WorkloadResources | null,
): DaemonSetRow {
  const status = d.status
  const res = resources ?? ZERO_RESOURCES

  return {
    namespace: d.metadata?.namespace ?? '',
    name: d.metadata?.name ?? '',
    desired: status?.desiredNumberScheduled ?? 0,
    current: status?.currentNumberScheduled ?? 0,
    ready: status?.numberReady ?? 0,
    available: status?.numberAvailable ?? 0,
    up_to_date: status?.updatedNumberScheduled ?? 0,
    update_strategy: d.spec?.updateStrategy?.type ?? 'RollingUpdate',
    age: ageOf(d.metadata?.creationTimestamp),
    cpu: res.cpu,
    memory: res.memory,
    cpu_request: res.cpu_request,
    memory_request: res.memory_request,
    cpu_limit: res.cpu_limit,
    memory_limit: res.memory_limit,
  }
}

export type JobRow = {
  namespace: string
  name: string
  completions: string
  status: string
  duration: string | null
  age: string | null
  cpu: number | null
  memory: number | null
  cpu_request: number | null
  memory_request: number | null
  cpu_limit: number | null
  memory_limit: number | null
}

// Wall-clock runtime of a Job: end - startTime, where end is completionTime
// for succeeded Jobs, the Failed/Complete condition's transition time for
// finished Jobs that never set completionTime (failed Jobs typically don't),
// and only `now` while the Job is genuinely still running. Without the
// condition fallback a failed Job's duration would tick upward forever.
function jobDuration(j: k8s.V1Job): string | null {
  if (!j.status?.startTime) return null
  const start = new Date(j.status.startTime).getTime()
  const terminal = (j.status.conditions ?? []).find(
    (c) => (c.type === 'Complete' || c.type === 'Failed') && c.status === 'True',
  )
  const endIso = j.status.completionTime ?? terminal?.lastTransitionTime
  const end = endIso ? new Date(endIso).getTime() : Date.now()
  const sec = Math.max(0, Math.floor((end - start) / 1000))

  return sec < 60 ? `${String(sec)}s` : `${String(Math.floor(sec / 60))}m ${String(sec % 60)}s`
}

export function mapJobRow(j: k8s.V1Job, resources?: WorkloadResources | null): JobRow {
  const desired = j.spec?.completions ?? 1
  const succeeded = j.status?.succeeded ?? 0
  const res = resources ?? ZERO_RESOURCES

  return {
    namespace: j.metadata?.namespace ?? '',
    name: j.metadata?.name ?? '',
    completions: `${String(succeeded)}/${String(desired)}`,
    status: jobPhase(j),
    duration: jobDuration(j),
    age: ageOf(j.metadata?.creationTimestamp),
    cpu: res.cpu,
    memory: res.memory,
    cpu_request: res.cpu_request,
    memory_request: res.memory_request,
    cpu_limit: res.cpu_limit,
    memory_limit: res.memory_limit,
  }
}

export type CronJobRow = {
  namespace: string
  name: string
  schedule: string
  time_zone: string | null
  suspend: boolean
  active: number
  last_schedule: string | null
  age: string | null
}

export function mapCronJobRow(cj: k8s.V1CronJob): CronJobRow {
  return {
    namespace: cj.metadata?.namespace ?? '',
    name: cj.metadata?.name ?? '',
    schedule: cj.spec?.schedule ?? '',
    time_zone: cj.spec?.timeZone ?? null,
    suspend: cj.spec?.suspend === true,
    active: cj.status?.active?.length ?? 0,
    last_schedule: ageOf(cj.status?.lastScheduleTime),
    age: ageOf(cj.metadata?.creationTimestamp),
  }
}

// A single Job spawned by a CronJob, summarised for the CronJob detail's
// Jobs section. Mirrors the columns Aptakube surfaces (status / succeeded /
// failures / duration / age) without the per-pod resource aggregation the
// main Jobs list carries.
export type CronJobJobRow = {
  namespace: string
  name: string
  status: string
  failed: number
  completions: string
  duration: string | null
  age: string | null
}

export function mapCronJobJobRow(j: k8s.V1Job): CronJobJobRow {
  const desired = j.spec?.completions ?? 1
  const succeeded = j.status?.succeeded ?? 0

  return {
    namespace: j.metadata?.namespace ?? '',
    name: j.metadata?.name ?? '',
    status: jobPhase(j),
    failed: j.status?.failed ?? 0,
    completions: `${String(succeeded)}/${String(desired)}`,
    duration: jobDuration(j),
    age: ageOf(j.metadata?.creationTimestamp),
  }
}

export type CronJobDetail = {
  namespace: string
  name: string
  age: string | null
  labels: [string, string][]
  annotations: [string, string][]
  schedule: string
  time_zone: string | null
  suspend: boolean
  concurrency_policy: string
  last_schedule: string | null
  last_successful: string | null
  active: number
  successful_jobs_history_limit: number | null
  failed_jobs_history_limit: number | null
  starting_deadline_seconds: number | null
  jobs: CronJobJobRow[]
  // Set when the CronJob itself was readable but listing its Jobs failed
  // (e.g. RBAC grants `cronjobs` but not `jobs`). The UI uses this to show a
  // "couldn't load Jobs" state instead of a misleading empty-state.
  jobs_error: string | null
}
