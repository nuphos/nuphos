export type ContextInfo = {
  name: string
  cluster: string
  user: string
  namespace: string | null
  current: boolean
}

export type BindingAccess = {
  memberAllowList: string[]
  updatedAt: string | null
  updatedBy: string | null
}

export type NamespaceItem = {
  name: string
  status: string
  age: string | null
}

export type PodItem = {
  namespace: string
  name: string
  ports: PodPort[]
  ready: string
  status: string
  restarts: number
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
  labels: Record<string, string>
}

export type PodLabelSelectorRequirement = {
  key: string
  operator: 'In' | 'NotIn' | 'Exists' | 'DoesNotExist'
  values?: string[]
}

export type PodLabelSelector = {
  matchLabels?: Record<string, string>
  matchExpressions?: PodLabelSelectorRequirement[]
}

export type PodPort = {
  name?: string
  port: number
  protocol?: string
}

export type DeploymentItem = {
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

export type DeploymentEnvContainerType = 'containers' | 'initContainers'

export type DeploymentEnvSource =
  | 'value'
  | 'configMapKeyRef'
  | 'secretKeyRef'
  | 'fieldRef'
  | 'resourceFieldRef'
  | 'fileKeyRef'
  | 'unknown'

export type DeploymentEnvEntry = {
  name: string
  value: string | null
  source: DeploymentEnvSource
  sourceLabel: string
  optional: boolean | null
  refName: string | null
  key: string | null
  apiVersion: string | null
  fieldPath: string | null
  containerName: string | null
  resource: string | null
  divisor: string | null
  // fileKeyRef only: the volume mount holding the env file, and the file's
  // path within it.
  volumeName: string | null
  path: string | null
}

export type DeploymentEnvFromEntry = {
  source: 'configMapRef' | 'secretRef' | 'unknown'
  name: string | null
  prefix: string | null
  optional: boolean | null
}

export type DeploymentEnvContainer = {
  type: DeploymentEnvContainerType
  name: string
  image: string | null
  env: DeploymentEnvEntry[]
  envFrom: DeploymentEnvFromEntry[]
}

export type DeploymentEnvDetail = {
  namespace: string
  name: string
  containers: DeploymentEnvContainer[]
}

// fileKeyRef is read-only here: the API server owns EnvFiles wiring, and the
// editor never rebuilds one.
export type DeploymentEnvEntryInput = {
  name: string
  source: Exclude<DeploymentEnvSource, 'unknown' | 'fileKeyRef'>
  value?: string
  refName?: string
  key?: string
  optional?: boolean | null
  apiVersion?: string
  fieldPath?: string
  containerName?: string
  resource?: string
  divisor?: string
}

export type DeploymentEnvFromInput = {
  source: 'configMapRef' | 'secretRef'
  name: string
  prefix?: string
  optional?: boolean | null
}

export type DeploymentEnvUpdateInput = {
  env: DeploymentEnvEntryInput[]
  envFrom: DeploymentEnvFromInput[]
}

export type NodeItem = {
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

// Per-container usage vs. spec limit, for the Overview "High / Abnormal
// Resource Usage" table. CPU in millicores, memory in bytes. `*_pct` is
// usage/limit*100, null when that dimension has no limit.
