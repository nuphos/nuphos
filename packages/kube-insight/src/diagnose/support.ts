import { eventContainer, eventCount, eventTime, isoOf } from '../kube.ts'

import type { Evidence } from './types.ts'
import type { ContainerStatus, KubeEvent, Pod } from '../kube.ts'

/**
 * How long a failure keeps counting: the kubelet resets a container's restart
 * back-off once it "has executed for 10 minutes without any problems"
 * (https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#restart-policy).
 */
export const RECENT_MS = 10 * 60 * 1000

/** Whether `at` lies within RECENT_MS of `now`; true when either is unknown. */
export function recent(at: number | null, now: number | null): boolean {
  if (at == null || now == null) return true

  return now - at <= RECENT_MS
}

const OUTPUT_LIMIT = 200

/** Cuts probe output and similar text to a readable length. */
export function truncate(text: string): string {
  const chars = [...text]

  return chars.length > OUTPUT_LIMIT ? `${chars.slice(0, OUTPUT_LIMIT).join('')}…` : text
}

/** `status.containerStatuses[name=api]`, or the init list it belongs to. */
function statusPath(pod: Pod, status: ContainerStatus): string {
  const init = pod.status?.initContainerStatuses?.includes(status)

  return `status.${init ? 'initContainerStatuses' : 'containerStatuses'}[name=${status.name}]`
}

export function statusField(
  pod: Pod,
  podName: string,
  status: ContainerStatus,
  rest: string,
  value: string | number | null = null,
): Evidence {
  return {
    type: 'field',
    object: { kind: 'Pod', name: podName },
    path: `${statusPath(pod, status)}.${rest}`,
    value: value == null ? null : String(value),
  }
}

export function eventEvidence(podName: string, event: KubeEvent): Evidence {
  const at = eventTime(event)

  return {
    type: 'event',
    object: { kind: 'Pod', name: podName },
    reason: event.reason ?? '',
    message: truncate(event.message ?? ''),
    count: eventCount(event),
    lastSeen: at == null ? null : isoOf(new Date(at)),
  }
}

/** Warning events about `container`, or about the pod when they name none. */
export function eventsFor(events: readonly KubeEvent[], reason: string, container?: string) {
  return events.filter((e) => {
    if (e.reason !== reason) return false
    const named = eventContainer(e)

    return container == null || named == null || named === container
  })
}
