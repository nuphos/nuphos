import { message } from '../message.ts'

import type { HealthResult } from './types.ts'
import type { DaemonSet, Deployment, Job, StatefulSet, Workload } from '../kube.ts'

// Workload health follows Argo CD's built-in checks (gitops-engine
// pkg/health/health_{deployment,statefulset,daemonset,job}.go): a spec the
// controller has not observed yet is Progressing, a rollout still replacing
// or waiting for replicas is Progressing, and a finished rollout is Healthy.

const HEALTHY: HealthResult = { status: 'Healthy', message: null }

function unobserved(workload: Workload): HealthResult | null {
  const generation = workload.metadata?.generation
  const observed =
    workload.status && 'observedGeneration' in workload.status
      ? workload.status.observedGeneration
      : undefined

  if (generation != null && observed != null && observed < generation)
    return { status: 'Progressing', message: message('health.workload.generation') }

  return null
}

function deploymentHealth(d: Deployment): HealthResult {
  if (d.spec?.paused) return { status: 'Suspended', message: message('health.workload.paused') }
  const pending = unobserved(d)

  if (pending) return pending
  const progressing = d.status?.conditions?.find((c) => c.type === 'Progressing')

  if (progressing?.reason === 'ProgressDeadlineExceeded') {
    return {
      status: 'Degraded',
      message: message('health.workload.deadline', { message: progressing.message ?? '' }),
    }
  }
  const desired = d.spec?.replicas ?? 1
  const updated = d.status?.updatedReplicas ?? 0
  const available = d.status?.availableReplicas ?? 0

  if (updated < desired || (d.status?.replicas ?? 0) > updated)
    return {
      status: 'Progressing',
      message: message('health.workload.updating', { updated, desired }),
    }
  if (available < updated) {
    return {
      status: 'Progressing',
      message: message('health.workload.available', { available, desired }),
    }
  }

  return HEALTHY
}

function statefulSetHealth(s: StatefulSet): HealthResult {
  const pending = unobserved(s)

  if (pending) return pending
  if (s.spec?.updateStrategy?.type === 'OnDelete') return HEALTHY
  const desired = s.spec?.replicas ?? 1
  const ready = s.status?.readyReplicas ?? 0

  if (ready < desired) {
    return {
      status: 'Progressing',
      message: message('health.workload.available', { available: ready, desired }),
    }
  }
  if (s.status?.updateRevision && s.status.currentRevision !== s.status.updateRevision) {
    return {
      status: 'Progressing',
      message: message('health.workload.updating', {
        updated: s.status.updatedReplicas ?? 0,
        desired,
      }),
    }
  }

  return HEALTHY
}

function daemonSetHealth(d: DaemonSet): HealthResult {
  const pending = unobserved(d)

  if (pending) return pending
  if (d.spec?.updateStrategy?.type === 'OnDelete') return HEALTHY
  const desired = d.status?.desiredNumberScheduled ?? 0
  const updated = d.status?.updatedNumberScheduled ?? 0
  const available = d.status?.numberAvailable ?? 0

  if (updated < desired)
    return {
      status: 'Progressing',
      message: message('health.workload.updating', { updated, desired }),
    }
  if (available < desired) {
    return {
      status: 'Progressing',
      message: message('health.workload.available', { available, desired }),
    }
  }

  return HEALTHY
}

function jobHealth(j: Job): HealthResult {
  const conditions = j.status?.conditions ?? []
  const failed = conditions.find((c) => c.type === 'Failed' && c.status === 'True')

  if (failed) {
    return {
      status: 'Degraded',
      message: message('health.job.failed', { reason: failed.reason ?? 'Failed' }),
    }
  }
  if (conditions.some((c) => c.type === 'Complete' && c.status === 'True')) return HEALTHY
  if (j.spec?.suspend) return { status: 'Suspended', message: message('health.job.suspended') }

  return {
    status: 'Progressing',
    message: message('health.job.running', { active: j.status?.active ?? 0 }),
  }
}

export function workloadHealth(workload: Workload | null | undefined): HealthResult {
  if (!workload) return { status: 'Missing', message: message('health.missing') }
  switch (workload.kind) {
    case 'Deployment':
      return deploymentHealth(workload)
    case 'StatefulSet':
      return statefulSetHealth(workload)
    case 'DaemonSet':
      return daemonSetHealth(workload)
    case 'Job':
      return jobHealth(workload)
  }
}
