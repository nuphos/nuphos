// The slice of the Kubernetes API objects this package reads. Structural, so
// plain JSON from the API server and @kubernetes/client-node's model classes
// both fit; timestamps may arrive as RFC 3339 strings or as Date objects.

export type Time = string | Date

export type ObjectMeta = {
  name?: string
  namespace?: string
  generation?: number
  deletionTimestamp?: Time
  creationTimestamp?: Time
}

export type Probe = {
  periodSeconds?: number
  failureThreshold?: number
}

export type Container = {
  name: string
  image?: string
  resources?: { limits?: Record<string, string>; requests?: Record<string, string> }
  livenessProbe?: Probe
  readinessProbe?: Probe
  startupProbe?: Probe
}

export type ContainerState = {
  waiting?: { reason?: string; message?: string }
  running?: { startedAt?: Time }
  terminated?: { reason?: string; message?: string; exitCode: number; finishedAt?: Time }
}

export type ContainerStatus = {
  name: string
  image?: string
  ready: boolean
  restartCount: number
  state?: ContainerState
  lastState?: ContainerState
}

export type Condition = {
  type: string
  status: string
  reason?: string
  message?: string
  lastTransitionTime?: Time
}

export type Pod = {
  metadata?: ObjectMeta
  spec?: {
    containers: Container[]
    initContainers?: Container[]
    restartPolicy?: string
  }
  status?: {
    phase?: string
    reason?: string
    message?: string
    conditions?: Condition[]
    containerStatuses?: ContainerStatus[]
    initContainerStatuses?: ContainerStatus[]
  }
}

export type KubeEvent = {
  type?: string
  reason?: string
  message?: string
  count?: number
  firstTimestamp?: Time
  lastTimestamp?: Time
  eventTime?: Time
  series?: { count?: number; lastObservedTime?: Time }
  involvedObject: { kind?: string; name?: string; namespace?: string; fieldPath?: string }
  metadata?: ObjectMeta
}

type UpdateStrategy = { type?: string }

export type Deployment = {
  kind: 'Deployment'
  metadata?: ObjectMeta
  spec?: { replicas?: number; paused?: boolean }
  status?: {
    observedGeneration?: number
    replicas?: number
    updatedReplicas?: number
    availableReplicas?: number
    conditions?: Condition[]
  }
}

export type StatefulSet = {
  kind: 'StatefulSet'
  metadata?: ObjectMeta
  spec?: { replicas?: number; updateStrategy?: UpdateStrategy }
  status?: {
    observedGeneration?: number
    replicas?: number
    readyReplicas?: number
    updatedReplicas?: number
    currentRevision?: string
    updateRevision?: string
  }
}

export type DaemonSet = {
  kind: 'DaemonSet'
  metadata?: ObjectMeta
  spec?: { updateStrategy?: UpdateStrategy }
  status?: {
    observedGeneration?: number
    desiredNumberScheduled: number
    updatedNumberScheduled?: number
    numberAvailable?: number
  }
}

export type Job = {
  kind: 'Job'
  metadata?: ObjectMeta
  spec?: { suspend?: boolean }
  status?: { active?: number; conditions?: Condition[] }
}

export type Workload = Deployment | StatefulSet | DaemonSet | Job

/** Epoch milliseconds of a timestamp, or null when absent or unparsable. */
export function timeOf(value: Time | undefined): number | null {
  if (value == null) return null
  const ms = value instanceof Date ? value.getTime() : Date.parse(value)

  return Number.isNaN(ms) ? null : ms
}

/** An RFC 3339 string for a timestamp, so results stay plain JSON. */
export function isoOf(value: Time | undefined): string | null {
  const ms = timeOf(value)

  return ms == null ? null : new Date(ms).toISOString()
}

/** All container statuses of a pod, init containers first. */
export function containerStatuses(pod: Pod): ContainerStatus[] {
  return [...(pod.status?.initContainerStatuses ?? []), ...(pod.status?.containerStatuses ?? [])]
}

/** The container spec named `name`, regular or init. */
export function containerSpec(pod: Pod, name: string): Container | undefined {
  return [...(pod.spec?.containers ?? []), ...(pod.spec?.initContainers ?? [])].find(
    (c) => c.name === name,
  )
}

/** When an event last happened: series, then lastTimestamp, eventTime, creation. */
export function eventTime(event: KubeEvent): number | null {
  return (
    timeOf(event.series?.lastObservedTime) ??
    timeOf(event.lastTimestamp) ??
    timeOf(event.eventTime) ??
    timeOf(event.metadata?.creationTimestamp)
  )
}

export function eventCount(event: KubeEvent): number {
  return event.series?.count ?? event.count ?? 1
}

/** The container an event names through `spec.containers{name}`, if any. */
export function eventContainer(event: KubeEvent): string | null {
  const match = /^spec\.(?:initContainers|containers|ephemeralContainers)\{(.+)\}$/.exec(
    event.involvedObject.fieldPath ?? '',
  )

  return match?.[1] ?? null
}
