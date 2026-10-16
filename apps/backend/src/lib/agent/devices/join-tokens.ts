import { createHash, randomBytes, randomUUID } from 'node:crypto'

import { db } from '@/lib/db'
import { getNuphosUserForCredential } from '@/lib/identity'

import { claimBoxAgentDevice, insertJoinedAgentDevice } from './store'

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
  /** Set at issue for a Box, whose device row already exists; otherwise set when used. */
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

/** Forgets the tokens made for a Box that is being removed. */
export async function deleteDeviceJoinTokens(deviceId: string): Promise<void> {
  await joinTokens().deleteMany({ deviceId })
}

export function hashDeviceSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('base64url')
}

const secret = (prefix: string) => `${prefix}${randomBytes(32).toString('base64url')}`

export async function issueDeviceJoinToken(
  userId: string,
  options: { label?: string; expiresInSec?: number; deviceId?: string },
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
    ...(options.deviceId ? { deviceId: options.deviceId } : {}),
    createdAt: now,
    expiresAt,
  })

  return { token, expiresAt }
}

/**
 * Uses the token once and registers a new device for its issuer, or returns
 * null when the token is not usable. The device id is the server's, so a token
 * can never take over a device that already exists.
 */
export async function redeemDeviceJoinToken(
  token: string,
  device: Pick<AgentDeviceRegistration, 'label' | 'platform'>,
): Promise<{ userId: string; deviceId: string; credential: string; box?: true } | null> {
  if (!token.startsWith(DEVICE_JOIN_TOKEN_PREFIX)) return null
  const now = new Date()
  const used = await joinTokens().findOneAndUpdate(
    { _id: hashDeviceSecret(token), usedAt: { $exists: false }, expiresAt: { $gt: now } },
    { $set: { usedAt: now } },
  )

  if (!used) return null
  const credential = secret(DEVICE_CREDENTIAL_PREFIX)
  const credentialHash = hashDeviceSecret(credential)

  if (used.deviceId) {
    // A Box: the server made the token for this team-owned row, which has no credential yet;
    // no person's sessions void it.
    if (!(await claimBoxAgentDevice(used.userId, used.deviceId, device.platform, credentialHash)))
      return null

    // Said by the server, so a host knows it is a Box only when it is one.
    return { userId: used.userId, deviceId: used.deviceId, credential, box: true }
  }
  // A person's machine: a token issued before "sign out everywhere" died with the sessions.
  if (!(await getNuphosUserForCredential(used.userId, used.createdAt))) return null
  const deviceId = randomUUID()

  await joinTokens().updateOne({ _id: used._id }, { $set: { deviceId } })
  await insertJoinedAgentDevice(
    used.userId,
    {
      deviceId,
      label: used.label ?? device.label,
      platform: device.platform,
      allowLocalExec: true,
    },
    credentialHash,
  )

  return { userId: used.userId, deviceId, credential }
}
