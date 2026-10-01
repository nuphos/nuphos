import type { WorkloadLogLine } from '../types/k8s-workloads.ts'

export type K8sWatchKind =
  | 'Pod'
  | 'Event'
  | 'Deployment'
  | 'Node'
  | 'Service'
  | 'ReplicaSet'
  | 'StatefulSet'
  | 'DaemonSet'
  | 'Job'
  | 'Ingress'
  | 'EndpointSlice'
  | 'ConfigMap'
  | 'Secret'
  | 'StorageClass'

export type K8sWatchStreamState = 'connecting' | 'live' | 'disconnected'

export type K8sWatchChangeKind = 'added' | 'modified' | 'deleted'

export type K8sWatchMetricsUpdate = {
  rowKey: string
  cpu: number | null
  memory: number | null
  // Set for Node + Workload rows by the metrics poller (sum of pod
  // requests scheduled on the node / matched by the workload selector).
  // Undefined for Pod rows — their request totals ride the regular
  // `change` events from the pod spec.
  cpu_request?: number | null
  memory_request?: number | null
  // Set for Node rows by the metrics poller: count of active scheduled pods.
  pods?: number | null
  // Set only for Workload rows (Deployment / StatefulSet) — sum of pod
  // limits when every matched pod declares one.
  cpu_limit?: number | null
  memory_limit?: number | null
}

// Row shape is opaque at the IPC boundary — each useWatchedList<T> caller
// narrows it via its generic parameter. Keeping it as `unknown` here avoids
// a giant per-kind union and means adding new kinds only touches the watch
// manager + the view that consumes them.
export type K8sWatchSubscribeResult<T = unknown> = {
  subscriptionId: string
  snapshot: T[]
  state: K8sWatchStreamState
  error?: string
}

export type WorkloadLogEvent =
  | { sessionId: string; type: 'lines'; lines: WorkloadLogLine[] }
  | { sessionId: string; type: 'error'; message: string }
  | { sessionId: string; type: 'warning'; message: string }
  | { sessionId: string; type: 'ready' }

export type K8sWatchEvent<T = unknown> =
  | { subscriptionId: string; type: 'snapshot'; rows: T[] }
  | {
      subscriptionId: string
      type: 'change'
      change: K8sWatchChangeKind
      rowKey: string
      row: T | null
    }
  | { subscriptionId: string; type: 'metrics'; updates: K8sWatchMetricsUpdate[] }
  | {
      subscriptionId: string
      type: 'status'
      state: K8sWatchStreamState
      error?: string
    }
