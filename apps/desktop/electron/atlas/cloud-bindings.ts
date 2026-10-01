import { call, withAwsRole, withGcpServiceAccount } from './client'

import type { BindingPurpose } from './clusters'
import type { BindingAccess } from './teams'

export type AwsAccount = {
  roleId: string
  accountId: string
  roleArn: string
  alias?: string
  canUse?: boolean
  createdAt?: string
  purpose?: BindingPurpose
}

export type GcpProject = {
  serviceAccountId: string
  projectId: string
  serviceAccountEmail: string
  alias?: string
  canUse?: boolean
  createdAt?: string
  purpose?: BindingPurpose
  /** Bind-time findings that don't invalidate the binding. */
  warnings?: string[]
}

export type CloudflareAccount = {
  id: string
  accountId: string
  accountName: string | null
  authType: 'oauth' | 'api_token'
  createdAt?: string
}

export async function bindAwsAccount(teamId: string, roleArn: string): Promise<AwsAccount> {
  return call<AwsAccount>('POST', `/teams/${teamId}/aws-accounts`, {
    roleArn,
  })
}

export async function unbindAwsAccount(
  teamId: string,
  accountId: string,
  roleId?: string,
): Promise<void> {
  await call<void>('DELETE', withAwsRole(`/teams/${teamId}/aws-accounts/${accountId}`, roleId))
}

export async function getAwsAccountAccess(
  teamId: string,
  accountId: string,
  roleId?: string,
): Promise<BindingAccess> {
  return call<BindingAccess>(
    'GET',
    withAwsRole(`/teams/${teamId}/aws-accounts/${accountId}/access`, roleId),
  )
}

export async function updateAwsAccountAccess(
  teamId: string,
  accountId: string,
  access: Pick<BindingAccess, 'memberAllowList'>,
  roleId?: string,
): Promise<BindingAccess> {
  return call<BindingAccess>(
    'PUT',
    withAwsRole(`/teams/${teamId}/aws-accounts/${accountId}/access`, roleId),
    access,
  )
}

export async function bindGcpProject(
  teamId: string,
  serviceAccountEmail: string,
  projectId: string,
): Promise<GcpProject> {
  return call<GcpProject>('POST', `/teams/${teamId}/gcp-projects`, {
    serviceAccountEmail,
    projectId,
  })
}

export async function unbindGcpProject(
  teamId: string,
  projectId: string,
  serviceAccountId?: string,
): Promise<void> {
  await call<void>(
    'DELETE',
    withGcpServiceAccount(`/teams/${teamId}/gcp-projects/${projectId}`, serviceAccountId),
  )
}

export async function getGcpProjectAccess(
  teamId: string,
  projectId: string,
  serviceAccountId?: string,
): Promise<BindingAccess> {
  return call<BindingAccess>(
    'GET',
    withGcpServiceAccount(`/teams/${teamId}/gcp-projects/${projectId}/access`, serviceAccountId),
  )
}

export async function updateGcpProjectAccess(
  teamId: string,
  projectId: string,
  access: Pick<BindingAccess, 'memberAllowList'>,
  serviceAccountId?: string,
): Promise<BindingAccess> {
  return call<BindingAccess>(
    'PUT',
    withGcpServiceAccount(`/teams/${teamId}/gcp-projects/${projectId}/access`, serviceAccountId),
    access,
  )
}

export async function bindCloudflareAccount(
  teamId: string,
  accountId: string,
  apiKey: string,
): Promise<CloudflareAccount> {
  return call<CloudflareAccount>(
    'POST',
    `/teams/${teamId}/cloudflare-accounts`,
    {
      accountId,
      apiKey,
    },
    { retry: false },
  )
}

export async function unbindCloudflareAccount(teamId: string, accountId: string): Promise<void> {
  await call<void>('DELETE', `/teams/${teamId}/cloudflare-accounts/${accountId}`, undefined, {
    retry: false,
  })
}

export async function listAwsAccounts(teamId: string): Promise<AwsAccount[]> {
  const data = await call<{ accounts: AwsAccount[] }>('GET', `/teams/${teamId}/aws-accounts`)

  return data.accounts ?? []
}

export async function listGcpProjects(teamId: string): Promise<GcpProject[]> {
  const data = await call<{ projects: GcpProject[] }>('GET', `/teams/${teamId}/gcp-projects`)

  return data.projects ?? []
}

export async function listCloudflareAccounts(teamId: string): Promise<CloudflareAccount[]> {
  const data = await call<{ accounts: CloudflareAccount[] }>(
    'GET',
    `/teams/${teamId}/cloudflare-accounts`,
  )

  return data.accounts ?? []
}
