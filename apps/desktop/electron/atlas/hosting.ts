import { call } from './client'
import { fetchKubeconfig } from './clusters'

export type ZeaburProvider = {
  providerId: string
  zeaburId: string
  kind: 'user' | 'team'
  name: string
  createdAt?: string
}

export type ZeaburProject = {
  id: string
  name: string
  status: string | null
  region: string | null
  createdAt: string | null
}

export type ZeaburServer = {
  id: string
  name: string
  status: string | null
  region: string | null
  createdAt: string | null
  ip?: string | null
  sshPort?: number | null
  sshUsername?: string | null
  isOnline?: boolean | null
  vmStatus?: string | null
  sshAvailable?: boolean | null
  latency?: number | null
  totalCPU?: number | null
  usedCPU?: number | null
  totalMemory?: number | null
  usedMemory?: number | null
  totalDisk?: number | null
  usedDisk?: number | null
  warnings?: string[]
}

export type LinodeInstance = {
  id: number
  label: string
  region: string
  type: string
  status: string
  ipv4: string[]
  ipv6: string | null
  created: string | null
}

export type HetznerServer = {
  id: number
  name: string
  status: string
  serverType: string
  location: string
  ipv4: string | null
  ipv6: string | null
  created: string | null
}

export type LkeCluster = {
  id: number
  label: string
  region: string
  k8s_version: string
  status: string
  created: string | null
}

export async function listZeaburProviders(teamId: string): Promise<ZeaburProvider[]> {
  const data = await call<{ providers: ZeaburProvider[] }>(
    'GET',
    `/teams/${teamId}/zeabur-providers`,
  )

  return data.providers ?? []
}

export async function bindZeaburProvider(
  atlasTeamId: string,
  token: string,
): Promise<ZeaburProvider[]> {
  const data = await call<{ providers: ZeaburProvider[] }>(
    'POST',
    `/teams/${atlasTeamId}/zeabur-providers`,
    { token },
    { retry: false },
  )

  return data.providers ?? []
}

export async function unbindZeaburProvider(teamId: string, zeaburId: string): Promise<void> {
  await call<void>('DELETE', `/teams/${teamId}/zeabur-providers/${zeaburId}`, undefined, {
    retry: false,
  })
}

export async function listZeaburProjects(
  teamId: string,
  zeaburId: string,
): Promise<ZeaburProject[]> {
  const data = await call<{ projects: ZeaburProject[] }>(
    'GET',
    `/teams/${teamId}/zeabur-providers/${zeaburId}/projects`,
  )

  return data.projects ?? []
}

export async function listZeaburServers(teamId: string, zeaburId: string): Promise<ZeaburServer[]> {
  const data = await call<{ servers: ZeaburServer[] }>(
    'GET',
    `/teams/${teamId}/zeabur-providers/${zeaburId}/servers`,
  )

  return data.servers ?? []
}

export async function listLinodeInstances(
  teamId: string,
  accountId: string,
): Promise<LinodeInstance[]> {
  const data = await call<{ instances: LinodeInstance[] }>(
    'GET',
    `/teams/${teamId}/linode-accounts/${accountId}/instances`,
  )

  return data.instances ?? []
}

export async function listHetznerServers(
  teamId: string,
  accountId: string,
): Promise<HetznerServer[]> {
  const data = await call<{ servers: HetznerServer[] }>(
    'GET',
    `/teams/${teamId}/hetzner-accounts/${accountId}/servers`,
  )

  return data.servers ?? []
}

export async function listLkeClusters(teamId: string, accountId: string): Promise<LkeCluster[]> {
  const data = await call<{ clusters: LkeCluster[] }>(
    'GET',
    `/teams/${teamId}/linode-accounts/${accountId}/lke-clusters`,
  )

  return data.clusters ?? []
}

export async function getLinodeLkeKubeconfig(
  teamId: string,
  accountId: string,
  clusterId: number,
): Promise<string> {
  const route = `/teams/${teamId}/linode-accounts/${accountId}/lke-clusters/${String(clusterId)}/kubeconfig`

  return (await fetchKubeconfig(route)).yaml
}
