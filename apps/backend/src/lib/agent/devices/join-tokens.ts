import { createHash, randomBytes } from 'node:crypto'

import { db } from '@/lib/db'

import { upsertAgentDeviceWithCredential } from './store'

import type { AgentDeviceRegistration } from './store'
import type { Collection } from 'mongodb'

// A join token lets one command on any machine register it as its issuer's
// device, without a browser sign-in or a copied session. The machine keeps a
// credential that opens only its own runtime tunnel and can be revoked alone.

export const DEVICE_JOIN_TOKEN_PREFIX = 'nbj_'
export const DEVICE_CREDENTIAL_PREFIX = 'nbx_'
export const DEVICE_JOIN_TOKEN_DEFAULT_TTL_SEC = 15 * 60
export const DEVICE_JOIN_TOKEN_MAX_TTL_SEC = 24 * 60 * 60

type DeviceJoinToken = {
  _id: string // sha256 of the token
  userId: string
  label?: string
  createdAt: Date
  expiresAt: Date
  usedAt?: Date
  deviceId?: string
}

const joinTokens = (): Collection<DeviceJoinToken> =>
  db().collection<DeviceJoinToken>('agent_device_join_tokens')

export async function setupDeviceJoinTokenIndexes(): Promise<void> {
  await joinTokens().createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0, name: 'agent_device_join_token_ttl' },
  )
}

export function hashDeviceSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('base64url')
}

const secret = (prefix: string) => `${prefix}${randomBytes(32).toString('base64url')}`

export async function issueDeviceJoinToken(
  userId: string,
  options: { label?: string; expiresInSec?: number },
): Promise<{ token: string; expiresAt: Date }> {
  const token = secret(DEVICE_JOIN_TOKEN_PREFIX)
  const now = new Date()
  const expiresAt = new Date(
    now.getTime() + (options.expiresInSec ?? DEVICE_JOIN_TOKEN_DEFAULT_TTL_SEC) * 1000,
  )

  await joinTokens().insertOne({
    _id: hashDeviceSecret(token),
    userId,
    ...(options.label ? { label: options.label } : {}),
    createdAt: now,
    expiresAt,
  })

  return { token, expiresAt }
}

/** Uses the token once and returns the device's new credential, or null when it is not usable. */
export async function redeemDeviceJoinToken(
  token: string,
  device: Omit<AgentDeviceRegistration, 'allowLocalExec'>,
): Promise<{ userId: string; deviceId: string; credential: string } | null> {
  if (!token.startsWith(DEVICE_JOIN_TOKEN_PREFIX)) return null
  const now = new Date()
  const used = await joinTokens().findOneAndUpdate(
    { _id: hashDeviceSecret(token), usedAt: { $exists: false }, expiresAt: { $gt: now } },
    { $set: { usedAt: now, deviceId: device.deviceId } },
  )

  if (!used) return null
  const credential = secret(DEVICE_CREDENTIAL_PREFIX)

  await upsertAgentDeviceWithCredential(
    used.userId,
    { ...device, label: used.label ?? device.label, allowLocalExec: true },
    hashDeviceSecret(credential),
  )

  return { userId: used.userId, deviceId: device.deviceId, credential }
}
