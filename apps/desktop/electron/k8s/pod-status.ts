import { k8sStatusTone } from '../../src/lib/k8sHealth.ts'

import type { V1ContainerStatus, V1Pod } from '@kubernetes/client-node'

export function containerStatusText(status: V1ContainerStatus | undefined): string {
  const state = status?.state

  if (state?.waiting) return state.waiting.reason || 'Waiting'
  if (state?.terminated) {
    const term = state.terminated

    if (term.reason) return term.reason
    if (term.signal) return `Signal:${String(term.signal)}`

    return term.exitCode === 0 ? 'Completed' : `ExitCode:${String(term.exitCode)}`
  }

  return state?.running ? 'Running' : 'Pending'
}

export function podStatusSummary(pod: V1Pod): { status: string; ready: string } {
  const spec = pod.spec
  const state = pod.status
  const regular = state?.containerStatuses ?? []
  const init = state?.initContainerStatuses ?? []
  const sidecarNames = new Set(
    (spec?.initContainers ?? []).filter((c) => c.restartPolicy === 'Always').map((c) => c.name),
  )
  const active = [...regular, ...init.filter((c) => sidecarNames.has(c.name))]
  const total = (spec?.containers?.length ?? 0) + sidecarNames.size
  const ready = `${String(active.filter((c) => c.ready).length)}/${String(total)}`
  const result = (status: string) => ({ status, ready })

  if (pod.metadata?.deletionTimestamp)
    return result(state?.reason === 'NodeLost' ? 'Unknown' : 'Terminating')
  if (state?.phase === 'Succeeded') return result('Completed')
  if (state?.phase === 'Failed') {
    const reason = state.reason || 'Failed'

    return result(k8sStatusTone(reason) === 'error' ? reason : `Failed:${reason}`)
  }
  if (state?.reason && k8sStatusTone(state.reason) === 'error') return result(state.reason)
  if (
    state?.conditions?.some(
      (c) => c.type === 'PodScheduled' && c.status === 'False' && c.reason === 'Unschedulable',
    )
  )
    return result('Unschedulable')

  // Faults take precedence over another container completing or starting.
  const faults = [...init, ...regular].filter(
    (c) => k8sStatusTone(containerStatusText(c)) === 'error',
  )

  if (faults.length) {
    const fault = faults[0]
    const prefix = init.includes(fault) ? 'Init:' : ''

    return result(prefix + containerStatusText(fault))
  }
  const initSpecs = spec?.initContainers ?? []

  for (let i = 0; i < initSpecs.length; i++) {
    const c = init.find((s) => s.name === initSpecs[i].name)

    if (sidecarNames.has(initSpecs[i].name) ? c?.started : c?.state?.terminated?.exitCode === 0)
      continue
    const reason = c?.state?.waiting?.reason

    return result(
      reason && reason !== 'PodInitializing'
        ? `Init:${reason}`
        : `Init:${String(i)}/${String(initSpecs.length)}`,
    )
  }
  const waiting = active.find((c) => c.state?.waiting)

  if (waiting) return result(containerStatusText(waiting))
  if (state?.phase === 'Running') {
    // A completed regular container is not a successfully completed Pod while
    // another container is still running. Readiness gates can also block an
    // otherwise fully ready set of containers.
    if (
      state.conditions?.some((c) => c.type === 'Ready' && c.status !== 'True') &&
      active.every((c) => c.ready)
    )
      return result('NotReady')

    return result('Running')
  }

  return result(state?.reason || state?.phase || 'Unknown')
}
