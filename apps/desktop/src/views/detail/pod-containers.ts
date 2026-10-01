import type { ContainerDetail, PodDetail } from '../../types'

export function allPodContainers(pod: PodDetail): ContainerDetail[] {
  return [...pod.containers, ...pod.init_containers, ...pod.ephemeral_containers]
}

export function containerDisplayName(container: ContainerDetail): string {
  if (container.is_init) return `Init: ${container.name}`
  if (container.is_ephemeral) return `Ephemeral: ${container.name}`

  return container.name
}
