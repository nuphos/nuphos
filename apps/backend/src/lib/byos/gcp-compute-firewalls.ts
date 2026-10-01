import { FirewallsClient } from '@google-cloud/compute'

import { impersonateSa } from './gcp'
import { clientOptionsFor, ensureConfigured } from './gcp-compute-shared'

import type { GcpHandle } from './gcp'

export type GcpFirewallRule = {
  name: string
  network: string
  priority: number
  direction: 'INGRESS' | 'EGRESS'
  disabled: boolean
  sourceRanges: string[]
  destinationRanges: string[]
  sourceTags: string[]
  targetTags: string[]
  allowed: { ipProtocol: string; ports: string[] }[]
  denied: { ipProtocol: string; ports: string[] }[]
  description?: string
  createdAt?: Date
}

function networkSelfLinkToName(selfLink: string): string {
  const m = /\/networks\/([^/]+)/.exec(selfLink)

  return m ? m[1]! : selfLink
}

function mapFirewall(f: {
  name?: string | null
  network?: string | null
  priority?: number | null
  direction?: string | null
  disabled?: boolean | null
  sourceRanges?: string[] | null
  destinationRanges?: string[] | null
  sourceTags?: string[] | null
  targetTags?: string[] | null
  allowed?: { IPProtocol?: string | null; ports?: string[] | null }[] | null
  denied?: { IPProtocol?: string | null; ports?: string[] | null }[] | null
  description?: string | null
  creationTimestamp?: string | null
}): GcpFirewallRule {
  return {
    name: f.name ?? '',
    network: f.network ? networkSelfLinkToName(f.network) : '',
    priority: f.priority ?? 1000,
    direction: (f.direction ?? 'INGRESS') as 'INGRESS' | 'EGRESS',
    disabled: f.disabled ?? false,
    sourceRanges: f.sourceRanges ?? [],
    destinationRanges: f.destinationRanges ?? [],
    sourceTags: f.sourceTags ?? [],
    targetTags: f.targetTags ?? [],
    allowed: (f.allowed ?? []).map((a) => ({
      ipProtocol: a.IPProtocol ?? '',
      ports: a.ports ?? [],
    })),
    denied: (f.denied ?? []).map((d) => ({
      ipProtocol: d.IPProtocol ?? '',
      ports: d.ports ?? [],
    })),
    description: f.description ?? undefined,
    createdAt: f.creationTimestamp ? new Date(f.creationTimestamp) : undefined,
  }
}

export async function listGcpFirewalls(handle: GcpHandle): Promise<GcpFirewallRule[]> {
  ensureConfigured()
  const impersonated = await impersonateSa(handle.serviceAccountEmail, handle.teamId)
  const client = new FirewallsClient(clientOptionsFor(impersonated))
  const [rules] = await client.list({ project: handle.projectId })

  return rules.map(mapFirewall)
}

export async function getGcpFirewall(
  handle: GcpHandle,
  name: string,
): Promise<GcpFirewallRule | null> {
  ensureConfigured()
  const impersonated = await impersonateSa(handle.serviceAccountEmail, handle.teamId)
  const client = new FirewallsClient(clientOptionsFor(impersonated))

  try {
    const [rule] = await client.get({ project: handle.projectId, firewall: name })

    return mapFirewall(rule)
  } catch (e) {
    if ((e as { code?: number }).code === 5) return null
    throw e
  }
}

export type GcpFirewallPatch = Partial<{
  priority: number
  disabled: boolean
  sourceRanges: string[]
  destinationRanges: string[]
  sourceTags: string[]
  targetTags: string[]
  allowed: { ipProtocol: string; ports?: string[] }[]
  denied: { ipProtocol: string; ports?: string[] }[]
  description: string
}>

export async function patchGcpFirewall(
  handle: GcpHandle,
  name: string,
  patch: GcpFirewallPatch,
): Promise<GcpFirewallRule> {
  ensureConfigured()
  const impersonated = await impersonateSa(handle.serviceAccountEmail, handle.teamId)
  const client = new FirewallsClient(clientOptionsFor(impersonated))

  const firewallResource: Record<string, unknown> = {}

  if (patch.priority !== undefined) firewallResource.priority = patch.priority
  if (patch.disabled !== undefined) firewallResource.disabled = patch.disabled
  if (patch.sourceRanges) firewallResource.sourceRanges = patch.sourceRanges
  if (patch.destinationRanges) firewallResource.destinationRanges = patch.destinationRanges
  if (patch.sourceTags) firewallResource.sourceTags = patch.sourceTags
  if (patch.targetTags) firewallResource.targetTags = patch.targetTags
  if (patch.allowed) {
    firewallResource.allowed = patch.allowed.map((a) => ({
      IPProtocol: a.ipProtocol,
      ports: a.ports,
    }))
  }
  if (patch.denied) {
    firewallResource.denied = patch.denied.map((d) => ({
      IPProtocol: d.ipProtocol,
      ports: d.ports,
    }))
  }
  if (patch.description !== undefined) firewallResource.description = patch.description

  const [op] = await client.patch({
    project: handle.projectId,
    firewall: name,
    firewallResource,
  })

  await op.promise()

  const updated = await getGcpFirewall(handle, name)

  if (!updated) throw new Error('Failed to re-fetch firewall after patch')

  return updated
}
