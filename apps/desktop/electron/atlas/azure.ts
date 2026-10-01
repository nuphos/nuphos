import { call } from './client'

import type { BindingAccess } from './teams'

export type AzureAccount = {
  id: string
  label: string
  tenantId: string
  clientId: string
  subscriptionId: string
  createdAt?: string
  // 'permission-admin' = human-only break-glass RBAC editor, never used by the agent.
  purpose?: 'permission-admin' | null
}

type AzureAccountResponse = {
  accountId: string
  label: string
  tenantId: string
  clientId: string
  subscriptionId: string
  createdAt?: string
  purpose?: 'permission-admin' | null
}

export async function listAzureAccounts(teamId: string): Promise<AzureAccount[]> {
  const data = await call<{ accounts: AzureAccountResponse[] }>(
    'GET',
    `/teams/${teamId}/azure-accounts`,
  )

  return (data.accounts ?? []).map((a) => ({
    id: a.accountId,
    label: a.label,
    tenantId: a.tenantId,
    clientId: a.clientId,
    subscriptionId: a.subscriptionId,
    createdAt: a.createdAt,
    purpose: a.purpose ?? null,
  }))
}

// OIDC federation details the customer needs to add a federated credential to
// their Entra ID app registration: issuer URL, this team's subject claim, and
// the audience. Azure auto-fetches the JWKS from the issuer, so no key to paste.
export type AzureOidcInfo = {
  configured: boolean
  issuer: string
  subject: string
  audience: string
}

export async function getAzureOidcInfo(teamId: string): Promise<AzureOidcInfo> {
  return call<AzureOidcInfo>('GET', `/teams/${teamId}/azure-accounts/oidc-info`)
}

export async function bindAzureAccount(
  teamId: string,
  label: string,
  tenantId: string,
  clientId: string,
  subscriptionId: string,
): Promise<AzureAccount> {
  const a = await call<AzureAccountResponse>(
    'POST',
    `/teams/${teamId}/azure-accounts`,
    { label, tenantId, clientId, subscriptionId },
    // Bind verifies the app is assumable + can read the subscription before
    // storing — give it sweep-level headroom so a slow route doesn't abort it.
    { retry: false, timeoutMs: 30_000 },
  )

  return {
    id: a.accountId,
    label: a.label,
    tenantId: a.tenantId,
    clientId: a.clientId,
    subscriptionId: a.subscriptionId,
    createdAt: a.createdAt,
    purpose: a.purpose ?? null,
  }
}

export async function unbindAzureAccount(teamId: string, accountId: string): Promise<void> {
  await call<void>('DELETE', `/teams/${teamId}/azure-accounts/${accountId}`, undefined, {
    retry: false,
  })
}

export type AzureRoleAssignment = {
  roleName: string
  roleDefinitionId: string
  scope: string
}

export async function listAzureRoleAssignments(
  teamId: string,
  accountId: string,
): Promise<AzureRoleAssignment[]> {
  const data = await call<{ assignments: AzureRoleAssignment[] }>(
    'GET',
    `/teams/${teamId}/azure-accounts/${accountId}/role-assignments`,
  )

  return data.assignments ?? []
}

export async function getAzureAccountAccess(
  teamId: string,
  accountId: string,
): Promise<BindingAccess> {
  return call<BindingAccess>('GET', `/teams/${teamId}/azure-accounts/${accountId}/access`)
}

export async function updateAzureAccountAccess(
  teamId: string,
  accountId: string,
  access: Pick<BindingAccess, 'memberAllowList'>,
): Promise<BindingAccess> {
  return call<BindingAccess>('PUT', `/teams/${teamId}/azure-accounts/${accountId}/access`, access)
}
