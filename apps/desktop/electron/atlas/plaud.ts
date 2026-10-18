import { call } from './client'

import type { BindingAccess } from './teams'

export type PlaudAccount = {
  id: string
  label: string
  userName: string | null
  userEmail: string | null
  createdAt?: string
}

export type PlaudOAuthStart = {
  authorizeUrl: string
  state: string
  expiresAt: string
}

export async function listPlaudAccounts(teamId: string): Promise<PlaudAccount[]> {
  const data = await call<{ accounts?: PlaudAccount[] }>('GET', `/teams/${teamId}/plaud-accounts`)

  return data.accounts ?? []
}

export async function startPlaudOAuth(teamId: string): Promise<PlaudOAuthStart> {
  return call<PlaudOAuthStart>(
    'POST',
    `/teams/${teamId}/plaud-accounts/start-oauth`,
    {},
    {
      retry: false,
    },
  )
}

export async function cancelPlaudOAuth(teamId: string, state: string): Promise<void> {
  await call<void>(
    'DELETE',
    `/teams/${teamId}/plaud-accounts/start-oauth/${encodeURIComponent(state)}`,
    undefined,
    { retry: false },
  )
}

export async function unbindPlaud(teamId: string, bindingId: string): Promise<void> {
  await call<void>(
    'DELETE',
    `/teams/${teamId}/plaud-accounts/${encodeURIComponent(bindingId)}`,
    undefined,
    { retry: false },
  )
}

export async function getPlaudAccountAccess(
  teamId: string,
  bindingId: string,
): Promise<BindingAccess> {
  return call<BindingAccess>(
    'GET',
    `/teams/${teamId}/plaud-accounts/${encodeURIComponent(bindingId)}/access`,
  )
}

export async function updatePlaudAccountAccess(
  teamId: string,
  bindingId: string,
  access: Pick<BindingAccess, 'memberAllowList'>,
): Promise<BindingAccess> {
  return call<BindingAccess>(
    'PUT',
    `/teams/${teamId}/plaud-accounts/${encodeURIComponent(bindingId)}/access`,
    access,
    { retry: false },
  )
}
