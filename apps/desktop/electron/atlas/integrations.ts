import { call } from './client'

import type { BindingAccess } from './teams'

export type LinodeAccount = {
  id: string
  label: string
  createdAt?: string
}

export type HetznerAccount = {
  id: string
  label: string
  createdAt?: string
}

export type UpstashAccount = {
  id: string
  label: string
  email: string
  createdAt?: string
}

export type ResendIntegration = {
  id: string
  label: string
  permission: 'full_access' | 'sending_access'
  domains?: string[] | null
  createdAt?: string
}

// Forward an arbitrary Grafana request through the Nuphos backend's proxy.
// `path` should be the Grafana-side path (e.g. "/api/search?type=dash-db").
export async function listLinodeAccounts(teamId: string): Promise<LinodeAccount[]> {
  const data = await call<{ accounts: LinodeAccount[] }>('GET', `/teams/${teamId}/linode-accounts`)

  return data.accounts ?? []
}

export async function bindLinodeAccount(
  teamId: string,
  label: string,
  token: string,
): Promise<LinodeAccount> {
  return call<LinodeAccount>(
    'POST',
    `/teams/${teamId}/linode-accounts`,
    { label, token },
    { retry: false },
  )
}

export async function unbindLinodeAccount(teamId: string, accountId: string): Promise<void> {
  await call<void>('DELETE', `/teams/${teamId}/linode-accounts/${accountId}`, undefined, {
    retry: false,
  })
}

export async function listHetznerAccounts(teamId: string): Promise<HetznerAccount[]> {
  const data = await call<{ accounts: HetznerAccount[] }>(
    'GET',
    `/teams/${teamId}/hetzner-accounts`,
  )

  return data.accounts ?? []
}

export async function bindHetznerAccount(
  teamId: string,
  label: string,
  token: string,
): Promise<HetznerAccount> {
  return call<HetznerAccount>(
    'POST',
    `/teams/${teamId}/hetzner-accounts`,
    { label, token },
    { retry: false },
  )
}

export async function unbindHetznerAccount(teamId: string, accountId: string): Promise<void> {
  await call<void>('DELETE', `/teams/${teamId}/hetzner-accounts/${accountId}`, undefined, {
    retry: false,
  })
}

export async function listUpstashAccounts(teamId: string): Promise<UpstashAccount[]> {
  const data = await call<{ accounts: UpstashAccount[] }>(
    'GET',
    `/teams/${teamId}/upstash-accounts`,
  )

  return data.accounts ?? []
}

export async function bindUpstashAccount(
  teamId: string,
  label: string,
  email: string,
  apiKey: string,
): Promise<UpstashAccount> {
  return call<UpstashAccount>(
    'POST',
    `/teams/${teamId}/upstash-accounts`,
    { label, email, apiKey },
    { retry: false },
  )
}

export async function listResendIntegrations(teamId: string): Promise<ResendIntegration[]> {
  const data = await call<{ integrations: ResendIntegration[] }>(
    'GET',
    `/teams/${teamId}/resend-integrations`,
  )

  return data.integrations ?? []
}

export async function bindResendIntegration(
  teamId: string,
  label: string,
  apiKey: string,
): Promise<ResendIntegration> {
  return call<ResendIntegration>(
    'POST',
    `/teams/${teamId}/resend-integrations`,
    { label, apiKey },
    { retry: false },
  )
}

export async function unbindUpstashAccount(teamId: string, accountId: string): Promise<void> {
  await call<void>('DELETE', `/teams/${teamId}/upstash-accounts/${accountId}`, undefined, {
    retry: false,
  })
}

// Binding allow-list ("who on the team may use this credential") for the
// connectors whose /access endpoints previously had no client at all. Same
// admin-gated GET/PUT shape as the AWS/GCP pair above.
export async function getUpstashAccountAccess(
  teamId: string,
  accountId: string,
): Promise<BindingAccess> {
  return call<BindingAccess>('GET', `/teams/${teamId}/upstash-accounts/${accountId}/access`)
}

export async function updateUpstashAccountAccess(
  teamId: string,
  accountId: string,
  access: Pick<BindingAccess, 'memberAllowList'>,
): Promise<BindingAccess> {
  return call<BindingAccess>('PUT', `/teams/${teamId}/upstash-accounts/${accountId}/access`, access)
}

export async function getTencentAccountAccess(
  teamId: string,
  accountId: string,
): Promise<BindingAccess> {
  return call<BindingAccess>('GET', `/teams/${teamId}/tencent-accounts/${accountId}/access`)
}

export async function updateTencentAccountAccess(
  teamId: string,
  accountId: string,
  access: Pick<BindingAccess, 'memberAllowList'>,
): Promise<BindingAccess> {
  return call<BindingAccess>('PUT', `/teams/${teamId}/tencent-accounts/${accountId}/access`, access)
}

export async function getAliyunAccountAccess(
  teamId: string,
  accountId: string,
): Promise<BindingAccess> {
  return call<BindingAccess>('GET', `/teams/${teamId}/aliyun-accounts/${accountId}/access`)
}

export async function updateAliyunAccountAccess(
  teamId: string,
  accountId: string,
  access: Pick<BindingAccess, 'memberAllowList'>,
): Promise<BindingAccess> {
  return call<BindingAccess>('PUT', `/teams/${teamId}/aliyun-accounts/${accountId}/access`, access)
}

export async function getVolcengineAccountAccess(
  teamId: string,
  accountId: string,
): Promise<BindingAccess> {
  return call<BindingAccess>('GET', `/teams/${teamId}/volcengine-accounts/${accountId}/access`)
}

export async function updateVolcengineAccountAccess(
  teamId: string,
  accountId: string,
  access: Pick<BindingAccess, 'memberAllowList'>,
): Promise<BindingAccess> {
  return call<BindingAccess>(
    'PUT',
    `/teams/${teamId}/volcengine-accounts/${accountId}/access`,
    access,
  )
}

export async function getHuaweiAccountAccess(
  teamId: string,
  accountId: string,
): Promise<BindingAccess> {
  return call<BindingAccess>('GET', `/teams/${teamId}/huawei-accounts/${accountId}/access`)
}

export async function updateHuaweiAccountAccess(
  teamId: string,
  accountId: string,
  access: Pick<BindingAccess, 'memberAllowList'>,
): Promise<BindingAccess> {
  return call<BindingAccess>('PUT', `/teams/${teamId}/huawei-accounts/${accountId}/access`, access)
}

export async function getBetterStackIntegrationAccess(
  teamId: string,
  integrationId: string,
): Promise<BindingAccess> {
  return call<BindingAccess>(
    'GET',
    `/teams/${teamId}/betterstack-integrations/${integrationId}/access`,
  )
}

export async function updateBetterStackIntegrationAccess(
  teamId: string,
  integrationId: string,
  access: Pick<BindingAccess, 'memberAllowList'>,
): Promise<BindingAccess> {
  return call<BindingAccess>(
    'PUT',
    `/teams/${teamId}/betterstack-integrations/${integrationId}/access`,
    access,
  )
}

export async function unbindResendIntegration(
  teamId: string,
  integrationId: string,
): Promise<void> {
  await call<void>('DELETE', `/teams/${teamId}/resend-integrations/${integrationId}`, undefined, {
    retry: false,
  })
}
