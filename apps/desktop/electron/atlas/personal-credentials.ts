import { call } from './client'

import type { PersonalCredential, PersonalCredentialProvider } from '../../src/types/team'

// The signed-in member's own GitHub / Linear grants — user-scoped, not team-scoped.
export async function listPersonalCredentials(): Promise<PersonalCredential[]> {
  const res = await call<{ credentials: PersonalCredential[] }>('GET', '/personal-credentials')

  return res.credentials
}

export function startPersonalCredential(
  provider: PersonalCredentialProvider,
): Promise<{ authorizeUrl: string; state: string }> {
  return call('POST', `/personal-credentials/${provider}/start`, undefined, { retry: false })
}

export async function deletePersonalCredential(
  provider: PersonalCredentialProvider,
): Promise<void> {
  await call('DELETE', `/personal-credentials/${provider}`, undefined, { retry: false })
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
