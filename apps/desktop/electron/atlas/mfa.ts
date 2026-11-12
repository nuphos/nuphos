import { hostname } from 'node:os'

import { runPasskeyCeremony } from '../auth/passkey.ts'

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

/** Step-up with a passkey, through nuphos.ai in the browser. */
export async function reauthWithPasskey(): Promise<void> {
  const options = await call('POST', '/auth/mfa/passkey-options', undefined, { retry: false })
  const passkey = await runPasskeyCeremony('get', options)

  await call('POST', '/auth/mfa/reauth', { passkey }, { retry: false })
}

/** Adds a passkey, named after this computer. */
export async function addPasskey(): Promise<void> {
  const options = await call('POST', '/auth/mfa/passkeys/options', undefined, { retry: false })
  const response = await runPasskeyCeremony('create', options)

  await call(
    'POST',
    '/auth/mfa/passkeys',
    { response, name: hostname().slice(0, 64) },
    { retry: false },
  )
}

export async function removePasskey(id: string, code: string): Promise<void> {
  await call('DELETE', `/auth/mfa/passkeys/${encodeURIComponent(id)}`, { code }, { retry: false })
}
