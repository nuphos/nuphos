import { servicePortOptions } from './port-forward-options'
import { ageOf, selectorToString, serviceExternalIps } from './utils'

import type { PortForwardPort } from './port-forward-shared'
import type * as k8s from '@kubernetes/client-node'

export type ServiceRow = {
  namespace: string
  name: string
  kind: string
  cluster_ip: string | null
  external_ips: string[]
  ports: string[]
  servicePorts: PortForwardPort[]
  age: string | null
}

export function mapServiceRow(svc: k8s.V1Service): ServiceRow {
  const ports =
    svc.spec?.ports?.map((p) => {
      const proto = p.protocol ?? 'TCP'

      return p.nodePort
        ? `${String(p.port)}:${String(p.nodePort)}/${proto}`
        : `${String(p.port)}/${proto}`
    }) ?? []

  return {
    namespace: svc.metadata?.namespace ?? '',
    name: svc.metadata?.name ?? '',
    kind: svc.spec?.type ?? 'ClusterIP',
    cluster_ip: svc.spec?.clusterIP ?? null,
    external_ips: serviceExternalIps(svc),
    ports,
    servicePorts: servicePortOptions(svc),
    age: ageOf(svc.metadata?.creationTimestamp),
  }
}

export type IngressRow = {
  namespace: string
  name: string
  class: string
  hosts: string[]
  addresses: string[]
  age: string | null
}

export function mapIngressRow(ing: k8s.V1Ingress): IngressRow {
  const hosts = (ing.spec?.rules ?? []).map((r) => r.host).filter((h): h is string => Boolean(h))
  const lb = ing.status?.loadBalancer?.ingress ?? []
  const addresses = lb.map((l) => l.ip || l.hostname).filter((a): a is string => Boolean(a))

  return {
    namespace: ing.metadata?.namespace ?? '',
    name: ing.metadata?.name ?? '',
    class: ing.spec?.ingressClassName ?? '',
    hosts,
    addresses,
    age: ageOf(ing.metadata?.creationTimestamp),
  }
}

export type EndpointSliceRow = {
  namespace: string
  name: string
  address_type: string
  ports: string[]
  endpoints: number
  ready: number
  service_name: string | null
  age: string | null
}

export function mapEndpointSliceRow(es: k8s.V1EndpointSlice): EndpointSliceRow {
  const ports = (es.ports ?? []).map((p) => {
    const proto = p.protocol ?? 'TCP'

    return p.port != null ? `${String(p.port)}/${proto}` : proto
  })
  const endpointCount = es.endpoints?.length ?? 0
  const ready = (es.endpoints ?? []).filter((e) => e.conditions?.ready !== false).length

  return {
    namespace: es.metadata?.namespace ?? '',
    name: es.metadata?.name ?? '',
    address_type: es.addressType,
    ports,
    endpoints: endpointCount,
    ready,
    service_name: es.metadata?.labels?.['kubernetes.io/service-name'] ?? null,
    age: ageOf(es.metadata?.creationTimestamp),
  }
}

export type NetworkPolicyRow = {
  namespace: string
  name: string
  pod_selector: string
  policy_types: string[]
  ingress_rules: number
  egress_rules: number
  age: string | null
}

export function mapNetworkPolicyRow(np: k8s.V1NetworkPolicy): NetworkPolicyRow {
  return {
    namespace: np.metadata?.namespace ?? '',
    name: np.metadata?.name ?? '',
    pod_selector: selectorToString(np.spec?.podSelector),
    policy_types: np.spec?.policyTypes ?? [],
    ingress_rules: np.spec?.ingress?.length ?? 0,
    egress_rules: np.spec?.egress?.length ?? 0,
    age: ageOf(np.metadata?.creationTimestamp),
  }
}
