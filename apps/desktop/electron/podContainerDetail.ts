import { containerStatusText } from './k8s/pod-status.ts'
// PodDetail's container rows, built from a Pod's spec plus its status.
// Returning the renderer's ContainerDetail makes tsc compare this projection
// against the type the Pod overview draws, and keeping both container lists
// here puts them on one tested code path.
import { containerEnvProjection } from './containerEnv.ts'

import type { ContainerDetail } from '../src/types'
import type * as k8s from '@kubernetes/client-node'

// Extension-qualified so `node --test` can load this module directly.

/** The `containers` / `init_containers` halves of a PodDetail. */
export function podContainerDetails(
  spec: k8s.V1PodSpec,
  status: k8s.V1PodStatus,
): {
  containers: ContainerDetail[]
  init_containers: ContainerDetail[]
  ephemeral_containers: ContainerDetail[]
} {
  const statuses = status.containerStatuses ?? []
  const initStatuses = status.initContainerStatuses ?? []
  const ephemeralStatuses = status.ephemeralContainerStatuses ?? []

  return {
    containers: (spec.containers ?? []).map((container) =>
      podContainerDetail(container, byName(statuses, container.name), false),
    ),
    init_containers: (spec.initContainers ?? []).map((container) =>
      podContainerDetail(container, byName(initStatuses, container.name), true),
    ),
    ephemeral_containers: (spec.ephemeralContainers ?? []).map((container) =>
      podContainerDetail(
        container as k8s.V1Container,
        byName(ephemeralStatuses, container.name),
        false,
        true,
      ),
    ),
  }
}

function byName(statuses: k8s.V1ContainerStatus[], name: string) {
  return statuses.find((status) => status.name === name)
}

export function podContainerDetail(
  container: k8s.V1Container,
  status: k8s.V1ContainerStatus | undefined,
  isInit: boolean,
  isEphemeral = false,
): ContainerDetail {
  const requests = container.resources?.requests ?? {}
  const limits = container.resources?.limits ?? {}
  const lastTerminated = status?.lastState?.terminated

  return {
    name: container.name,
    image: container.image ?? '',
    status: containerStatusText(status),
    started: !!status?.started,
    ready: !!status?.ready,
    restarts: status?.restartCount ?? 0,
    restart_reason: lastTerminated?.reason ?? null,
    last_restart: lastTerminated?.finishedAt
      ? new Date(lastTerminated.finishedAt).toISOString()
      : null,
    cpu_request: requests.cpu ?? null,
    cpu_limit: limits.cpu ?? null,
    memory_request: requests.memory ?? null,
    memory_limit: limits.memory ?? null,
    ...containerEnvProjection(container),
    is_init: isInit,
    is_ephemeral: isEphemeral,
  }
}
