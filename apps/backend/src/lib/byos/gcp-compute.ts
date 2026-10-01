import { InstancesClient, NetworksClient } from '@google-cloud/compute'

import { impersonateSa } from './gcp'
import { clientOptionsFor, ensureConfigured } from './gcp-compute-shared'

import type { GcpHandle } from './gcp'

export { getGcpFirewall, listGcpFirewalls, patchGcpFirewall } from './gcp-compute-firewalls'
export type { GcpFirewallPatch, GcpFirewallRule } from './gcp-compute-firewalls'
export { getGceInstanceSshAccess } from './gcp-compute-ssh'
export type { GcpComputeSshAccess } from './gcp-compute-ssh'

export type GcpVpc = {
  name: string
  selfLink: string
  autoCreateSubnetworks: boolean
  routingMode?: string
  createdAt?: Date
}

export type GcpComputeInstance = {
  name: string
  id: string | null
  zone: string
  region: string
  machineType: string
  status: string
  publicIp: string | null
  privateIp: string | null
  network: string | null
  subnetwork: string | null
  serviceAccounts: string[]
  labels: Record<string, string>
  createdAt: string | null
}

export async function listGcpVpcs(handle: GcpHandle): Promise<GcpVpc[]> {
  ensureConfigured()
  const impersonated = await impersonateSa(handle.serviceAccountEmail, handle.teamId)
  const client = new NetworksClient(clientOptionsFor(impersonated))
  const [networks] = await client.list({ project: handle.projectId })

  return networks.map((n) => ({
    name: n.name ?? '',
    selfLink: n.selfLink ?? '',
    autoCreateSubnetworks: n.autoCreateSubnetworks ?? false,
    routingMode: n.routingConfig?.routingMode ?? undefined,
    createdAt: n.creationTimestamp ? new Date(n.creationTimestamp) : undefined,
  }))
}

export async function getGcpVpc(handle: GcpHandle, name: string): Promise<GcpVpc | null> {
  ensureConfigured()
  const impersonated = await impersonateSa(handle.serviceAccountEmail, handle.teamId)
  const client = new NetworksClient(clientOptionsFor(impersonated))

  try {
    const [n] = await client.get({ project: handle.projectId, network: name })

    return {
      name: n.name ?? '',
      selfLink: n.selfLink ?? '',
      autoCreateSubnetworks: n.autoCreateSubnetworks ?? false,
      routingMode: n.routingConfig?.routingMode ?? undefined,
      createdAt: n.creationTimestamp ? new Date(n.creationTimestamp) : undefined,
    }
  } catch (e) {
    if ((e as { code?: number }).code === 5) return null
    throw e
  }
}

function lastSegment(value: string | null | undefined): string {
  if (!value) return ''
  const slash = value.lastIndexOf('/')

  return slash === -1 ? value : value.slice(slash + 1)
}

function zoneToRegion(zone: string): string {
  // GCE zones are <region>-<letter>, e.g. us-central1-a.
  const dash = zone.lastIndexOf('-')

  return dash === -1 ? zone : zone.slice(0, dash)
}

type RawGceInstance = {
  name?: string | null
  id?: string | number | bigint | null
  zone?: string | null
  machineType?: string | null
  status?: string | null
  networkInterfaces?:
    | {
        networkIP?: string | null
        network?: string | null
        subnetwork?: string | null
        accessConfigs?: { natIP?: string | null }[] | null
      }[]
    | null
  serviceAccounts?: { email?: string | null }[] | null
  labels?: Record<string, string> | null
  creationTimestamp?: string | null
}

function mapGceInstance(i: RawGceInstance, fallbackZone: string): GcpComputeInstance | null {
  if (!i.name) return null
  const zone = lastSegment(i.zone) || fallbackZone
  const primary = (i.networkInterfaces ?? [])[0]
  const publicIp = primary?.accessConfigs?.find((a) => a.natIP)?.natIP ?? null

  return {
    name: i.name,
    id: i.id != null ? String(i.id) : null,
    zone,
    region: zoneToRegion(zone),
    machineType: lastSegment(i.machineType),
    status: i.status ?? 'unknown',
    publicIp,
    privateIp: primary?.networkIP ?? null,
    network: primary?.network ? lastSegment(primary.network) : null,
    subnetwork: primary?.subnetwork ? lastSegment(primary.subnetwork) : null,
    serviceAccounts: (i.serviceAccounts ?? [])
      .map((s) => s.email ?? '')
      .filter((s) => s.length > 0),
    labels: i.labels ?? {},
    createdAt: i.creationTimestamp ?? null,
  }
}

export async function listGceInstances(handle: GcpHandle): Promise<GcpComputeInstance[]> {
  ensureConfigured()
  const impersonated = await impersonateSa(handle.serviceAccountEmail, handle.teamId)
  const client = new InstancesClient(clientOptionsFor(impersonated))
  const aggregated = client.aggregatedListAsync({ project: handle.projectId, maxResults: 500 })

  const out: GcpComputeInstance[] = []

  for await (const [zoneKey, scoped] of aggregated) {
    const zone = zoneKey.startsWith('zones/') ? zoneKey.slice('zones/'.length) : zoneKey

    for (const inst of scoped.instances ?? []) {
      const mapped = mapGceInstance(inst as RawGceInstance, zone)

      if (mapped) out.push(mapped)
    }
  }
  out.sort((a, b) => a.zone.localeCompare(b.zone) || a.name.localeCompare(b.name))

  return out
}
