import { eventTime, timeOf } from '../../kube.ts'
import { message } from '../../message.ts'
import { eventEvidence, eventsFor, recent } from '../support.ts'

import type { Evidence, Finding, PodContext, Rule } from '../types.ts'

// A Pending pod whose PodScheduled condition is False with reason
// Unschedulable waits for a node; the scheduler's message (also in the
// FailedScheduling event) says what is short.

const SHORTAGES = ['cpu', 'memory', 'volume', 'placement', 'other'] as const

type Shortage = (typeof SHORTAGES)[number]

export function shortage(text: string): Shortage {
  if (text.includes('Insufficient cpu')) return 'cpu'
  if (text.includes('Insufficient memory')) return 'memory'
  if (/PersistentVolumeClaim|volume node affinity|persistentvolumeclaim/.test(text)) return 'volume'
  if (['taint', 'affinity', 'selector'].some((word) => text.includes(word))) return 'placement'

  return 'other'
}

function unschedulable({ pod, podName, events, now }: PodContext): Finding[] {
  if (pod.status?.phase !== 'Pending') return []
  const condition = pod.status.conditions?.find(
    (c) => c.type === 'PodScheduled' && c.status === 'False' && c.reason === 'Unschedulable',
  )
  const failed = eventsFor(events, 'FailedScheduling').filter((e) => recent(eventTime(e), now))

  if (!condition && failed.length === 0) return []
  const latest = failed.reduce<(typeof failed)[number] | undefined>(
    (best, e) => (best && (eventTime(best) ?? 0) >= (eventTime(e) ?? 0) ? best : e),
    undefined,
  )
  const text = condition?.message ?? latest?.message ?? ''
  const variant = shortage(text)
  const evidence: Evidence[] = []

  if (condition) {
    evidence.push({
      type: 'field',
      object: { kind: 'Pod', name: podName },
      path: 'status.conditions[type=PodScheduled].reason',
      value: 'Unschedulable',
    })
  }
  if (latest) evidence.push(eventEvidence(podName, latest))

  return [
    {
      container: null,
      cause: message(`diagnosis.unschedulable.cause.${variant}`),
      why: message('diagnosis.unschedulable.why', { message: text }),
      fix: message(`diagnosis.unschedulable.fix.${variant}`),
      evidence,
      actions: [],
      at: (latest ? eventTime(latest) : null) ?? timeOf(condition?.lastTransitionTime),
    },
  ]
}

export const unschedulableRule: Rule = {
  id: 'unschedulable',
  severity: 'critical',
  fixKind: 'edit-config',
  sources: [
    {
      title: 'Kubernetes: Pod conditions',
      url: 'https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-conditions',
    },
    {
      title: 'Kubernetes: Debug pods, my pod stays pending',
      url: 'https://kubernetes.io/docs/tasks/debug/debug-application/debug-pods/#my-pod-stays-pending',
    },
    {
      title: 'Kubernetes: Assigning pods to nodes',
      url: 'https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/',
    },
  ],
  messageKeys: [
    ...SHORTAGES.map((s) => `diagnosis.unschedulable.cause.${s}`),
    ...SHORTAGES.map((s) => `diagnosis.unschedulable.fix.${s}`),
    'diagnosis.unschedulable.why',
  ],
  check: unschedulable,
}
