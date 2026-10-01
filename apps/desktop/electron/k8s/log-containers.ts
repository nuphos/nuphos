import type * as k8s from '@kubernetes/client-node'

// Include init and ephemeral containers because they commonly hold the only
// useful log for startup failures and live debugging sessions.
export function podLogContainers(pod: k8s.V1Pod): { name: string; instance: number }[] {
  const statuses = [
    ...(pod.status?.containerStatuses ?? []),
    ...(pod.status?.initContainerStatuses ?? []),
    ...(pod.status?.ephemeralContainerStatuses ?? []),
  ]

  return [
    ...(pod.spec?.containers ?? []),
    ...(pod.spec?.initContainers ?? []),
    ...(pod.spec?.ephemeralContainers ?? []),
  ].map((container) => ({
    name: container.name,
    instance: statuses.find((status) => status.name === container.name)?.restartCount ?? 0,
  }))
}
