import { call } from './client'

export type TailscaleSandboxAccess = {
  enabled: boolean
  tag: string
  enabledAt?: string
}

export type TailscaleOAuthClient = {
  id: string
  label: string
  clientId: string
  createdAt?: string
  sandboxAccess?: TailscaleSandboxAccess | null
}

export type TailscaleDevice = {
  id: string
  name: string
  hostname: string | null
  os: string | null
  user: string | null
  addresses: string[]
  tags: string[]
  online: boolean | null
  authorized: boolean | null
  createdAt: string | null
  lastSeen: string | null
  expiresAt: string | null
}

export async function listTailscaleClients(teamId: string): Promise<TailscaleOAuthClient[]> {
  const data = await call<{ clients: TailscaleOAuthClient[] }>(
    'GET',
    `/teams/${teamId}/tailscale-clients`,
  )

  return data.clients ?? []
}

export async function bindTailscaleClient(
  teamId: string,
  label: string,
  clientId: string,
  clientSecret: string | null,
  federated?: boolean,
): Promise<TailscaleOAuthClient> {
  return call<TailscaleOAuthClient>(
    'POST',
    `/teams/${teamId}/tailscale-clients`,
    federated ? { label, clientId, federated: true } : { label, clientId, clientSecret },
    { retry: false },
  )
}

export async function unbindTailscaleClient(teamId: string, clientId: string): Promise<void> {
  await call<void>('DELETE', `/teams/${teamId}/tailscale-clients/${clientId}`, undefined, {
    retry: false,
  })
}

export async function listTailscaleDevices(
  teamId: string,
  clientId: string,
): Promise<TailscaleDevice[]> {
  const data = await call<{ devices: TailscaleDevice[] }>(
    'GET',
    `/teams/${teamId}/tailscale-clients/${clientId}/devices`,
  )

  return data.devices ?? []
}

export async function setTailscaleSandboxAccess(
  teamId: string,
  clientId: string,
  enabled: boolean,
  tag: string,
): Promise<TailscaleOAuthClient> {
  return call<TailscaleOAuthClient>(
    'PUT',
    `/teams/${teamId}/tailscale-clients/${clientId}/sandbox-access`,
    { enabled, tag },
    { retry: false },
  )
}

export async function generateTailscaleAclSnippet(
  teamId: string,
  clientId: string,
  targetTag: string,
  sshUsers: string[],
  recorderTag?: string,
): Promise<string> {
  const data = await call<{ snippet: string }>(
    'POST',
    `/teams/${teamId}/tailscale-clients/${clientId}/acl-snippet`,
    { targetTag, sshUsers, recorderTag },
    { retry: false },
  )

  return data.snippet
}
