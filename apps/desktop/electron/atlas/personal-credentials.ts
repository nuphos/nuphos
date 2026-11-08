import { call } from './client'

import type { PersonalCredential, PersonalCredentialProvider } from '../../src/types/team'

// The signed-in member's own GitHub / Linear grants — user-scoped, not team-scoped.
export async function listPersonalCredentials(): Promise<PersonalCredential[]> {
  const res = await call<{ credentials: PersonalCredential[] }>('GET', '/personal-credentials')

  return res.credentials
}

// Gmail / Google Drive connect through a team's own Google OAuth client.
export function startPersonalCredential(
  provider: PersonalCredentialProvider,
  teamId?: string,
): Promise<{ authorizeUrl: string; state: string }> {
  return call('POST', `/personal-credentials/${provider}/start`, teamId ? { teamId } : undefined, {
    retry: false,
  })
}

export type TeamGoogleClient = { clientId: string | null; defaultClient: boolean }

export async function getTeamGoogleClient(teamId: string): Promise<TeamGoogleClient> {
  const res = await call<{ clientId: string | null; defaultClient?: boolean }>(
    'GET',
    `/teams/${teamId}/google-oauth-client`,
  )

  // Older servers have no default client.
  return { clientId: res.clientId, defaultClient: res.defaultClient ?? false }
}

export async function setTeamGoogleClient(
  teamId: string,
  clientId: string,
  clientSecret: string,
): Promise<void> {
  await call(
    'PUT',
    `/teams/${teamId}/google-oauth-client`,
    { clientId, clientSecret },
    {
      retry: false,
    },
  )
}

export async function deleteTeamGoogleClient(teamId: string): Promise<void> {
  await call('DELETE', `/teams/${teamId}/google-oauth-client`, undefined, { retry: false })
}

export async function deletePersonalCredential(
  provider: PersonalCredentialProvider,
  teamId?: string,
): Promise<void> {
  const query = teamId ? `?teamId=${encodeURIComponent(teamId)}` : ''

  await call('DELETE', `/personal-credentials/${provider}${query}`, undefined, { retry: false })
}

export function completePersonalCredential(
  provider: PersonalCredentialProvider,
  state: string,
  code: string,
): Promise<PersonalCredential> {
  return call(
    'POST',
    `/personal-credentials/${provider}/complete`,
    { state, code },
    { retry: false },
  )
}
