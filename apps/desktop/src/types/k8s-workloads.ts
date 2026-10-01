import type { PodPort } from './k8s-core.ts'

export type ContainerUsageRow = {
  namespace: string
  pod: string
  container: string
  node: string | null
  cpu_usage: number | null
  cpu_limit: number | null
  cpu_pct: number | null
  memory_usage: number | null
  memory_limit: number | null
  memory_pct: number | null
}

export type ServiceItem = {
  namespace: string
  name: string
  kind: string
  cluster_ip: string | null
  external_ips: string[]
  ports: string[]
  servicePorts: PodPort[]
  age: string | null
}

export type ReplicaSetItem = {
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

export type StatefulSetItem = {
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

export type DaemonSetItem = {
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

export type JobItem = {
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

export type CronJobItem = {
  namespace: string
  name: string
  schedule: string
  time_zone: string | null
  suspend: boolean
  active: number
  last_schedule: string | null
  age: string | null
}

export type CronJobJobItem = {
  namespace: string
  name: string
  status: string
  failed: number
  completions: string
  duration: string | null
  age: string | null
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
  jobs: CronJobJobItem[]
  jobs_error: string | null
}

export type CronJobContainer = {
  name: string
  image: string
  command: string[]
  args: string[]
}

export type CronJobTriggerInfo = {
  namespace: string
  name: string
  schedule: string
  suspend: boolean
  containers: CronJobContainer[]
}

export type WorkloadLogLine = {
  timestamp: string | null
  pod: string
  container: string
  message: string
}

// One options bag for every log read (renderer mirror of electron's LogQuery),
// so a new knob — sinceSeconds today; follow / grep / container filter later —
// never has to thread a positional arg through the IPC chain.
export type LogQuery = {
  tailLines?: number
  previous?: boolean
  sinceSeconds?: number
}
