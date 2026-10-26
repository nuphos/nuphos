import { call } from './client'

import type { SignInSession } from '../../src/types/team'

// The signed-in member's own sign-ins. Only a sign-in session may call these;
// one from before sessions existed gets `session_required`.
export async function listSignInSessions(): Promise<SignInSession[]> {
  const res = await call<{ sessions: SignInSession[] }>('GET', '/auth/sessions')

  return res.sessions
}

export async function signOutSession(id: string): Promise<void> {
  await call('DELETE', `/auth/sessions/${encodeURIComponent(id)}`, undefined, { retry: false })
}

export async function signOutOtherSessions(): Promise<number> {
  const res = await call<{ revoked: number }>('DELETE', '/auth/sessions', undefined, {
    retry: false,
  })

  return res.revoked
}
