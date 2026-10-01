import yaml from 'js-yaml'

import type { OverviewChip } from './shared'
import type { DetailTarget } from './target'
import type { HealthTone } from '../../lib/k8sHealth'

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function recordAt(value: unknown, key: string): UnknownRecord {
  if (!isRecord(value)) return {}
  const next = value[key]

  return isRecord(next) ? next : {}
}

function stringAt(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null
  const next = value[key]

  return typeof next === 'string' ? next : null
}

function numberAt(value: unknown, key: string): number | null {
  if (!isRecord(value)) return null
  const next = value[key]

  return typeof next === 'number' ? next : null
}

function recordStringEntries(value: unknown): [string, string][] {
  if (!isRecord(value)) return []

  return Object.entries(value).flatMap(([key, val]) =>
    typeof val === 'string' ? [[key, val] as [string, string]] : [],
  )
}

function pairChips(entries: [string, string][]): OverviewChip[] {
  return entries.map(([key, value]) => ({
    label: `${key}: ${value}`,
    title: `${key}: ${value}`,
  }))
}

function selectorChips(selector: UnknownRecord): OverviewChip[] {
  const chips = pairChips(recordStringEntries(selector.matchLabels))
  const expressions = Array.isArray(selector.matchExpressions) ? selector.matchExpressions : []

  for (const expression of expressions) {
    if (!isRecord(expression)) continue
    const key = stringAt(expression, 'key')
    const operator = stringAt(expression, 'operator')

    if (!key || !operator) continue
    const values = Array.isArray(expression.values)
      ? expression.values.filter((value): value is string => typeof value === 'string')
      : []
    const valueText = values.length > 0 ? ` (${values.join(', ')})` : ''

    chips.push({ label: `${key} ${operator}${valueText}` })
  }

  return chips
}

function containerImagesFromTemplate(template: UnknownRecord): OverviewChip[] {
  const spec = recordAt(template, 'spec')
  const containers = Array.isArray(spec.containers) ? spec.containers.filter(isRecord) : []
  const initContainers = Array.isArray(spec.initContainers)
    ? spec.initContainers.filter(isRecord)
    : []

  return [...containers, ...initContainers].flatMap((container) => {
    if (!isRecord(container)) return []
    const name = stringAt(container, 'name')
    const image = stringAt(container, 'image')

    if (!image) return []

    return [{ label: name ? `${name}: ${image}` : image, title: image }]
  })
}

function conditionTone(type: string, state: string, reason: string | null): HealthTone {
  const normalizedType = type.toLowerCase()
  const normalizedReason = reason?.toLowerCase() ?? ''

  if (state === 'Unknown') return 'warning'
  if (/fail|error/.test(normalizedType)) return state === 'True' ? 'error' : 'neutral'
  if (state === 'True' && /fail|error|deadline|invalid|unavailable/.test(normalizedReason)) {
    return 'error'
  }
  if (/available|ready|progressing|complete/.test(normalizedType)) {
    return state === 'True' ? 'success' : 'error'
  }

  return 'neutral'
}

function conditionChips(status: UnknownRecord): OverviewChip[] {
  const conditions = Array.isArray(status.conditions) ? status.conditions : []

  return conditions.flatMap((condition) => {
    if (!isRecord(condition)) return []
    const type = stringAt(condition, 'type')
    const state = stringAt(condition, 'status')

    if (!type || !state) return []
    const reason = stringAt(condition, 'reason')
    const message = stringAt(condition, 'message')

    return [
      {
        label: `${type}: ${state}`,
        title: [reason, message].filter(Boolean).join(' - ') || `${type}: ${state}`,
        tone: conditionTone(type, state, reason),
      },
    ]
  })
}

function workloadReplicaText(kind: string, spec: UnknownRecord, status: UnknownRecord) {
  if (kind === 'DaemonSet') {
    const desired = numberAt(status, 'desiredNumberScheduled')
    const ready = numberAt(status, 'numberReady')
    const available = numberAt(status, 'numberAvailable')

    if (desired !== null || ready !== null || available !== null) {
      return `${String(ready ?? 0)} ready / ${String(available ?? 0)} available / ${String(desired ?? 0)} desired`
    }

    return '-'
  }
  if (kind === 'Job') {
    const completions = numberAt(spec, 'completions')
    const succeeded = numberAt(status, 'succeeded')
    const parallelism = numberAt(spec, 'parallelism')

    return `${String(succeeded ?? 0)} succeeded / ${String(completions ?? 1)} completions / ${String(parallelism ?? 1)} parallelism`
  }
  const desired = numberAt(spec, 'replicas') ?? 1
  const ready = numberAt(status, 'readyReplicas') ?? 0
  const available = numberAt(status, 'availableReplicas') ?? 0

  return `${String(ready)} ready / ${String(available)} available / ${String(desired)} desired`
}

function workloadReplicaCounts(kind: string, spec: UnknownRecord, status: UnknownRecord) {
  if (kind === 'DaemonSet') {
    return {
      desired: numberAt(status, 'desiredNumberScheduled') ?? 0,
      ready: numberAt(status, 'numberReady') ?? 0,
      available: numberAt(status, 'numberAvailable') ?? 0,
      updated: numberAt(status, 'updatedNumberScheduled') ?? 0,
    }
  }
  if (kind === 'Job') {
    const desired = numberAt(spec, 'completions') ?? 1
    const ready = numberAt(status, 'succeeded') ?? 0

    return {
      desired,
      ready,
      available: numberAt(status, 'active') ?? 0,
      updated: numberAt(status, 'failed') ?? 0,
    }
  }
  const desired = numberAt(spec, 'replicas') ?? 1
  const ready = numberAt(status, 'readyReplicas') ?? 0

  return {
    desired,
    ready,
    available: numberAt(status, 'availableReplicas') ?? 0,
    updated:
      kind === 'ReplicaSet'
        ? (numberAt(status, 'replicas') ?? 0)
        : (numberAt(status, 'updatedReplicas') ?? numberAt(status, 'currentReplicas') ?? 0),
  }
}

export type JobState = 'running' | 'completing' | 'complete' | 'failed' | 'suspended' | 'pending'

function conditionIsTrue(status: UnknownRecord, type: string) {
  return recordsAt(status, 'conditions').some(
    (condition) => stringAt(condition, 'type') === type && stringAt(condition, 'status') === 'True',
  )
}

function recordsAt(value: unknown, key: string): UnknownRecord[] {
  if (!isRecord(value) || !Array.isArray(value[key])) return []

  return value[key].filter(isRecord)
}

function jobState(spec: UnknownRecord, status: UnknownRecord): JobState | null {
  if (conditionIsTrue(status, 'Failed') || conditionIsTrue(status, 'FailureTarget')) return 'failed'
  if (conditionIsTrue(status, 'Complete')) return 'complete'
  if (conditionIsTrue(status, 'Suspended') || spec.suspend === true) return 'suspended'
  if (conditionIsTrue(status, 'SuccessCriteriaMet')) return 'completing'
  if ((numberAt(status, 'active') ?? 0) > 0) return 'running'

  return 'pending'
}

function workloadUpdateText(kind: string, spec: UnknownRecord) {
  if (kind === 'Deployment') return stringAt(recordAt(spec, 'strategy'), 'type') ?? '-'
  if (kind === 'StatefulSet' || kind === 'DaemonSet') {
    return stringAt(recordAt(spec, 'updateStrategy'), 'type') ?? '-'
  }
  if (kind === 'Job') return stringAt(spec, 'completionMode') ?? 'NonIndexed'

  return '-'
}

export function parseWorkloadSummary(yamlText: string, target: DetailTarget) {
  let doc: unknown

  try {
    doc = yaml.load(yamlText)
  } catch {
    doc = null
  }
  const root = isRecord(doc) ? doc : {}
  const metadata = recordAt(root, 'metadata')
  const spec = recordAt(root, 'spec')
  const status = recordAt(root, 'status')
  const template = recordAt(spec, 'template')
  const templateMetadata = recordAt(template, 'metadata')
  const templateSpec = recordAt(template, 'spec')
  const annotations = recordAt(metadata, 'annotations')
  const replicaCounts = workloadReplicaCounts(target.kind, spec, status)

  return {
    apiVersion: stringAt(root, 'apiVersion') ?? target.apiVersion ?? '-',
    kind: stringAt(root, 'kind') ?? target.resourceKind ?? target.kind,
    namespace: stringAt(metadata, 'namespace') ?? target.namespace ?? '-',
    createdAt: stringAt(metadata, 'creationTimestamp') ?? target.age ?? null,
    generation: numberAt(metadata, 'generation'),
    observedGeneration: numberAt(status, 'observedGeneration'),
    replicas: workloadReplicaText(target.kind, spec, status),
    ...replicaCounts,
    jobState: target.kind === 'Job' ? jobState(spec, status) : null,
    update: workloadUpdateText(target.kind, spec),
    revision:
      stringAt(status, 'updateRevision') ??
      stringAt(status, 'currentRevision') ??
      stringAt(annotations, 'deployment.kubernetes.io/revision'),
    serviceAccount:
      stringAt(templateSpec, 'serviceAccountName') ??
      stringAt(spec, 'serviceAccountName') ??
      'default',
    selector: selectorChips(recordAt(spec, 'selector')),
    labels: pairChips(recordStringEntries(metadata.labels)),
    templateLabels: pairChips(recordStringEntries(templateMetadata.labels)),
    images: containerImagesFromTemplate(template),
    conditions: conditionChips(status),
  }
}

export type EditableWorkloadEnvKind = 'Deployment' | 'StatefulSet' | 'DaemonSet'

export function hasEditableWorkloadEnv(
  kind: DetailTarget['kind'],
): kind is EditableWorkloadEnvKind {
  return kind === 'Deployment' || kind === 'StatefulSet' || kind === 'DaemonSet'
}
