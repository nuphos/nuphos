import { getClients, withAuthRetry } from './client'

import type { PortForwardPort } from './port-forward-shared'
import type * as k8s from '@kubernetes/client-node'

export function podPortOptions(pod: k8s.V1Pod): PortForwardPort[] {
  return (pod.spec?.containers ?? []).flatMap((container) =>
    (container.ports ?? [])
      .filter((port) => !port.protocol || port.protocol === 'TCP')
      .map((port) => ({
        name: port.name,
        port: port.containerPort,
        protocol: port.protocol ?? 'TCP',
      })),
  )
}

export function servicePortOptions(service: k8s.V1Service): PortForwardPort[] {
  return (service.spec?.ports ?? [])
    .filter((port) => !port.protocol || port.protocol === 'TCP')
    .map((port) => ({
      name: port.name,
      port: port.port,
      protocol: port.protocol ?? 'TCP',
    }))
}

export function serviceSelectorString(service: k8s.V1Service): string {
  const selector = service.spec?.selector ?? {}

  return Object.entries(selector)
    .map(([key, value]) => `${key}=${value}`)
    .join(',')
}

export function isReadyPod(pod: k8s.V1Pod): boolean {
  return (pod.status?.conditions ?? []).some(
    (condition) => condition.type === 'Ready' && condition.status === 'True',
  )
}

export function resolveNamedPodPort(pod: k8s.V1Pod, name: string): number | null {
  for (const container of pod.spec?.containers ?? []) {
    for (const port of container.ports ?? []) {
      if (port.name === name && (!port.protocol || port.protocol === 'TCP')) {
        return port.containerPort
      }
    }
  }

  return null
}

export function getPodPortForwardOptions(context: string, namespace: string, podName: string) {
  return withAuthRetry(context, async () => {
    const { coreApi } = getClients(context)
    const pod = await coreApi.readNamespacedPod({ namespace, name: podName })

    return podPortOptions(pod)
  })
}

export function getServicePortForwardOptions(
  context: string,
  namespace: string,
  serviceName: string,
) {
  return withAuthRetry(context, async () => {
    const { coreApi } = getClients(context)
    const service = await coreApi.readNamespacedService({ namespace, name: serviceName })

    return servicePortOptions(service)
  })
}
