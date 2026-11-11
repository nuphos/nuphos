import { call } from './client'

import type { BindingAccess } from './teams'

export type TrelloIntegration = {
  id: string
  label: string
  memberId: string
  username: string
  authorizedBy: string
  createdAt?: string
}

export async function listTrelloIntegrations(teamId: string): Promise<TrelloIntegration[]> {
  const data = await call<{ integrations: TrelloIntegration[] }>(
    'GET',
    `/teams/${teamId}/trello-integrations`,
  )

  return data.integrations ?? []
}

export function getTrelloAccess(teamId: string, id: string): Promise<BindingAccess> {
  return call<BindingAccess>('GET', `/teams/${teamId}/trello-integrations/${id}/access`)
}

export function updateTrelloAccess(
  teamId: string,
  id: string,
  input: Pick<BindingAccess, 'memberAllowList'>,
): Promise<BindingAccess> {
  return call<BindingAccess>('PUT', `/teams/${teamId}/trello-integrations/${id}/access`, input, {
    retry: false,
  })
}

export async function unbindTrelloIntegration(teamId: string, id: string): Promise<void> {
  await call<void>('DELETE', `/teams/${teamId}/trello-integrations/${id}`, undefined, {
    retry: false,
  })
}

export async function startTrelloOAuth(teamId: string): Promise<TrelloOAuthStart> {
  return call<TrelloOAuthStart>(
    'POST',
    `/teams/${teamId}/trello-integrations/start-oauth`,
    {},
    { retry: false },
  )
}

export async function cancelTrelloOAuth(teamId: string, state: string): Promise<void> {
  await call<void>(
    'DELETE',
    `/teams/${teamId}/trello-integrations/start-oauth/${encodeURIComponent(state)}`,
    undefined,
    { retry: false },
  )
}

export type TrelloOAuthStart = { authorizeUrl: string; state: string; expiresAt: string }
