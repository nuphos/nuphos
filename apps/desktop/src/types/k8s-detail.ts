import type { DeploymentEnvEntry, DeploymentEnvFromEntry, PodItem, PodPort } from './k8s-core.ts'

export type ContainerDetail = {
  name: string
  image: string
  status: string
  started: boolean
  ready: boolean
  restarts: number
  restart_reason: string | null
  last_restart: string | null
  cpu_request: string | null
  cpu_limit: string | null
  memory_request: string | null
  memory_limit: string | null
  // secretKeyRef entries carry the Secret name/key reference, never a resolved
  // secret value.
  env: DeploymentEnvEntry[]
  envFrom: DeploymentEnvFromEntry[]
  is_init: boolean
  is_ephemeral: boolean
}

export type TolerationItem = {
  key: string
  effect: string
  operator: string | null
  value: string | null
}

export type PodConditionDetail = {
  type: string
  status: string
  reason: string | null
  message: string | null
}

export type PodDetail = {
  ready?: string
  namespace: string
  name: string
  ports: PodPort[]
  status: string
  phase: string
  node: string | null
  pod_ip: string | null
  host_ip: string | null
  qos: string | null
  service_account: string | null
  age: string | null
  start_time: string | null
  labels: [string, string][]
  annotations: [string, string][]
  conditions: PodConditionDetail[]
  tolerations: TolerationItem[]
  containers: ContainerDetail[]
  init_containers: ContainerDetail[]
  ephemeral_containers: ContainerDetail[]
  owner_kind: string | null
  owner_name: string | null
}

// Rich Node detail for the NodeOverview page (more than the NodeItem list row).
// Utilization aggregates and scheduled pods are added by later sub-issues.
export type NodeTaint = { key: string; value: string | null; effect: string }
export type NodeCondition = { type: string; status: string }

// One resource dimension (CPU in millicores, memory in bytes) for a node's
// Utilization cards. usage = live (metrics-server), capacity/allocatable from
// the node status, requests/limits summed over pods scheduled on the node.
// Any field is null when unavailable (e.g. metrics-server absent).
export type NodeResourceMeter = {
  usage: number | null
  capacity: number | null
  allocatable: number | null
  requests: number | null
  limits: number | null
}
export type NodeUtilization = { cpu: NodeResourceMeter; memory: NodeResourceMeter }

export type NodeDetail = {
  name: string
  status: string // Ready / NotReady / Unknown
  age: string | null
  os_image: string | null
  kernel_version: string | null
  kubelet_version: string | null
  kube_proxy_version: string | null
  hostname: string | null
  internal_ip: string | null
  external_ip: string | null
  roles: string[]
  taints: NodeTaint[]
  conditions: NodeCondition[]
  labels: [string, string][]
  annotations: [string, string][]
  schedulable: boolean
  utilization: NodeUtilization
  // Pods scheduled on this node (snapshot), and the node's pod capacity for the
  // "X / Y" header. Reuses PodItem so the table renders like the Pods view.
  // null = the pod list couldn't be fetched (RBAC / transient), distinct from
  // an empty array (genuinely no pods on the node).
  scheduled_pods: PodItem[] | null
  pods_capacity: number | null
}

export type EventItem = {
  uid?: string
  namespace: string
  kind: string
  name: string
  reason: string
  message: string
  count: number
  timestamp: string | null
  type_: string
}

export type ResourceKind = 'Pod' | 'Deployment' | 'Node' | 'Service'
