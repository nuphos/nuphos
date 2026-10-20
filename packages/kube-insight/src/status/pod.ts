import { containerStatuses } from '../kube.ts'
import { message } from '../message.ts'

import type { HealthResult } from './types.ts'
import type { Pod } from '../kube.ts'

// Pod health follows Argo CD's pod check (gitops-engine pkg/health/health_pod.go):
// Pending is Progressing, Succeeded is Healthy, Failed is Degraded, and a
// Running pod with restartPolicy Always is Healthy once every container is
// ready. One deviation: a container waiting with an error reason (Err*,
// *Error, *BackOff) is Degraded in every phase, not only Running, so a pod
// stuck on ImagePullBackOff or CreateContainerConfigError reads as broken.

const ERROR_WAITING = /^Err|Error$|BackOff$/

/** The first container waiting for an error reason, init containers first. */
function erroredContainer(pod: Pod) {
  for (const status of containerStatuses(pod)) {
    const reason = status.state?.waiting?.reason

    if (reason && ERROR_WAITING.test(reason)) return { status, reason }
  }

  return null
}

export function podHealth(pod: Pod | null | undefined): HealthResult {
  if (!pod) return { status: 'Missing', message: message('health.missing') }
  if (pod.metadata?.deletionTimestamp)
    return { status: 'Progressing', message: message('health.pod.terminating') }

  const phase = pod.status?.phase
  const errored = erroredContainer(pod)

  if (phase === 'Succeeded') return { status: 'Healthy', message: null }
  if (phase === 'Failed') {
    return {
      status: 'Degraded',
      message: message('health.pod.failed', { reason: pod.status?.reason ?? 'Failed' }),
    }
  }
  if (errored) {
    return {
      status: 'Degraded',
      message: message('health.pod.waiting', {
        container: errored.status.name,
        reason: errored.reason,
        restarts: errored.status.restartCount,
      }),
    }
  }
  if (phase === 'Pending') return { status: 'Progressing', message: message('health.pod.pending') }
  if (phase !== 'Running') return { status: 'Unknown', message: null }

  const statuses = pod.status?.containerStatuses ?? []
  const ready = statuses.filter((s) => s.ready).length
  const restartAlways = (pod.spec?.restartPolicy ?? 'Always') === 'Always'

  if (restartAlways && ready === statuses.length && statuses.length > 0)
    return { status: 'Healthy', message: null }

  return {
    status: 'Progressing',
    message: message('health.pod.notReady', { ready, total: statuses.length }),
  }
}
