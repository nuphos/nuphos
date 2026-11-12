import { call } from './client'

import type { MfaSetup, MfaStatus } from '../../src/types/team'

// Two-factor authentication on the signed-in account (Settings → Account →
// Two-factor authentication). Only a sign-in session may call these.
export async function getMfaStatus(): Promise<MfaStatus> {
  return call<MfaStatus>('GET', '/auth/mfa')
}

export async function startMfaSetup(): Promise<MfaSetup> {
  return call<MfaSetup>('POST', '/auth/mfa/totp/setup', undefined, { retry: false })
}

/** Turns it on; the recovery codes are shown only this once. */
export async function confirmMfaSetup(code: string): Promise<string[]> {
  const res = await call<{ recoveryCodes: string[] }>(
    'POST',
    '/auth/mfa/totp/confirm',
    { code },
    { retry: false },
  )

  return res.recoveryCodes
}

export async function newMfaRecoveryCodes(code: string): Promise<string[]> {
  const res = await call<{ recoveryCodes: string[] }>(
    'POST',
    '/auth/mfa/recovery-codes',
    { code },
    { retry: false },
  )

  return res.recoveryCodes
}

export async function disableMfa(code: string): Promise<void> {
  await call('POST', '/auth/mfa/disable', { code }, { retry: false })
}

/** Step-up: a current code makes this session recently verified again. */
export async function reauthMfa(code: string): Promise<void> {
  await call('POST', '/auth/mfa/reauth', { code }, { retry: false })
}
