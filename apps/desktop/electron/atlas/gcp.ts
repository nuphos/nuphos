import { appendQuery, call, withGcpServiceAccount } from './client'
import { fetchKubeconfig } from './clusters'

import type { CloudSshAccess } from './aws-lightsail'
import type { Vpc } from './aws-network'
import type { Cluster, KubeconfigResponse } from './clusters'

/**
 * Which Nuphos principal the customer grants Service Account Token Creator to.
 * `principal` is the workload identity subject for this team and the value the
 * wizard tells them to paste. A deploy without federation returns
 * `configured: false` and cannot bind GCP accounts.
 */
export type GcpWifInfo = {
  configured: boolean
  principal: string | null
}

export async function getGcpWifInfo(teamId: string): Promise<GcpWifInfo> {
  return call<GcpWifInfo>('GET', `/teams/${teamId}/gcp-projects/wif-info`)
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

export type GcpCloudRunService = {
  name: string
  region: string
  status: string
  url: string | null
  serviceAccountEmail: string | null
  ingress: string | null
  latestReadyRevision: string | null
  latestCreatedRevision: string | null
  creator: string | null
  traffic: { percent: number; revision: string | null; tag: string | null; type: string | null }[]
  conditions: { type: string; state: string; message: string | null }[]
  createdAt: string | null
  updatedAt: string | null
}

export type Firewall = {
  name: string
  network?: string
  direction?: string
  priority?: number
  sourceRanges?: string[]
  allowed?: { protocol: string; ports?: string[] }[]
}

type GcpRawVpc = {
  name: string
  selfLink?: string
  autoCreateSubnetworks?: boolean
  routingMode?: string
  createdAt?: string
}

type GcpRawFirewall = {
  name: string
  network?: string
  priority?: number
  direction?: string
  disabled?: boolean
  sourceRanges?: string[]
  destinationRanges?: string[]
  sourceTags?: string[]
  targetTags?: string[]
  allowed?: { ipProtocol: string; ports?: string[] }[]
  denied?: { ipProtocol: string; ports?: string[] }[]
  description?: string
  createdAt?: string
}

function mapGcpVpc(v: GcpRawVpc): Vpc {
  return {
    id: v.name,
    name: v.name,
    region: 'global',
  }
}

function mapGcpFirewall(f: GcpRawFirewall): Firewall {
  return {
    name: f.name,
    network: f.network,
    direction: f.direction,
    priority: f.priority,
    sourceRanges: f.sourceRanges,
    allowed: (f.allowed ?? []).map((a) => ({ protocol: a.ipProtocol, ports: a.ports })),
  }
}

export async function listGcpVpcs(
  teamId: string,
  projectId: string,
  serviceAccountId?: string,
): Promise<Vpc[]> {
  const data = await call<{ vpcs: GcpRawVpc[] }>(
    'GET',
    withGcpServiceAccount(`/teams/${teamId}/gcp-projects/${projectId}/vpcs`, serviceAccountId),
  )

  return (data.vpcs ?? []).map(mapGcpVpc)
}

export async function listGcpFirewalls(
  teamId: string,
  projectId: string,
  serviceAccountId?: string,
): Promise<Firewall[]> {
  const data = await call<{ firewalls: GcpRawFirewall[] }>(
    'GET',
    withGcpServiceAccount(`/teams/${teamId}/gcp-projects/${projectId}/firewalls`, serviceAccountId),
  )

  return (data.firewalls ?? []).map(mapGcpFirewall)
}

export async function listGcpClusters(
  teamId: string,
  projectId: string,
  serviceAccountId?: string,
): Promise<Cluster[]> {
  const data = await call<{ clusters: Cluster[] }>(
    'GET',
    withGcpServiceAccount(`/teams/${teamId}/gcp-projects/${projectId}/clusters`, serviceAccountId),
  )

  return data.clusters ?? []
}

export async function listGcpComputeInstances(
  teamId: string,
  projectId: string,
  serviceAccountId?: string,
): Promise<GcpComputeInstance[]> {
  const data = await call<{ instances: GcpComputeInstance[] }>(
    'GET',
    withGcpServiceAccount(
      `/teams/${teamId}/gcp-projects/${projectId}/gce-instances`,
      serviceAccountId,
    ),
  )

  return data.instances ?? []
}

export async function listGcpCloudRunServices(
  teamId: string,
  projectId: string,
  serviceAccountId?: string,
): Promise<GcpCloudRunService[]> {
  const data = await call<{ services: GcpCloudRunService[] }>(
    'GET',
    withGcpServiceAccount(
      `/teams/${teamId}/gcp-projects/${projectId}/cloud-run-services`,
      serviceAccountId,
    ),
  )

  return data.services ?? []
}

// TODO: wire GET /cloud-run-services/:region/:name and .../revisions through
// IPC once the desktop app gains a Cloud Run service detail view.

export async function getGcpComputeSshAccess(
  teamId: string,
  projectId: string,
  name: string,
  zone: string,
  serviceAccountId?: string,
): Promise<CloudSshAccess> {
  return call<CloudSshAccess>(
    'POST',
    withGcpServiceAccount(
      `/teams/${teamId}/gcp-projects/${projectId}/gce-instances/${encodeURIComponent(name)}/ssh-access`,
      serviceAccountId,
    ),
    { zone },
    { retry: false },
  )
}

export async function getGcpClusterKubeconfig(
  teamId: string,
  projectId: string,
  clusterName: string,
  location?: string,
  serviceAccountId?: string,
): Promise<KubeconfigResponse> {
  const q = appendQuery('', { location, serviceAccountId })

  return fetchKubeconfig(
    `/teams/${teamId}/gcp-projects/${projectId}/clusters/${clusterName}/kubeconfig${q}`,
  )
}
