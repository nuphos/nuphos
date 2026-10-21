import { randomInt } from 'node:crypto'

import { db } from '@/lib/db'
import { AppError } from '@/lib/errors'
import { getNuphosUserById, getTeamMembership } from '@/lib/identity'
import { mintCliToken } from '@/lib/identity/cli-tokens'
import { generateOpaqueToken, hashToken } from '@/lib/oauth/tokens'

import type { CliTokenPrincipal } from '@/lib/identity/cli-tokens'
import type { NuphosUser } from '@/lib/identity/types'

/**
 * Device sign-in for terminals with no browser (RFC 8628). The terminal gets
 * a secret `deviceCode` it polls with and a short `userCode` it shows. A
 * person signed in on nuphos.ai types the code, sees which machine asked, and
 * approves it as themselves or as a named agent. The next poll mints a CLI
 * token (`cli-tokens.ts`) and the request is gone.
 *
 * Consent phishing (someone sends you their code) is the known risk of this
 * flow. It is answered where the victim looks, on the approval page: the code
 * has to be typed, never arrives in a link, and the page names the requesting
 * machine and warns. Codes are short-lived and single-use, and guessing one is
 * rate-limited per approving user.
 */
export type DeviceLoginDoc = {
  /** hashToken(deviceCode) */
  _id: string
  /** hashToken(normalized userCode) */
  userCodeHash: string
  status: 'pending' | 'approved' | 'denied'
  clientName: string
  requesterIp?: string
  createdAt: Date
  expiresAt: Date
  lastPolledAt?: Date
  approval?: {
    userId: string
    kind: 'personal' | 'agent'
    teamId?: string
    name: string
    avatarUrl?: string
  }
}

export const deviceLogins = () => db().collection<DeviceLoginDoc>('device_logins')

export const DEVICE_LOGIN_TTL_SEC = 10 * 60
export const DEVICE_LOGIN_INTERVAL_SEC = 5

export async function setupDeviceLoginIndexes(): Promise<void> {
  await Promise.all([
    deviceLogins().createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, name: 'device_logins_ttl' },
    ),
    deviceLogins().createIndex(
      { userCodeHash: 1 },
      { unique: true, name: 'device_logins_user_code' },
    ),
  ])
}

// No vowels or look-alikes (0/O, 1/I/L): nothing to misread, and no words.
const ALPHABET = 'BCDFGHJKMNPQRSTVWXZ'

function newUserCode(): string {
  const chars = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)])

  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`
}

/** What a person typed, in the stored form: case and separators do not matter. */
export function normalizeUserCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const code = raw.toUpperCase().replace(/[^A-Z]/g, '')

  return code.length === 8 ? code : null
}

const CLIENT_NAME_RE = /[^\p{L}\p{N} ._-]/gu

export async function startDeviceLogin(input: { clientName?: unknown; requesterIp?: string }) {
  const clientName =
    (typeof input.clientName === 'string' ? input.clientName.replace(CLIENT_NAME_RE, '') : '')
      .trim()
      .slice(0, 64) || 'Nuphos CLI'
  const deviceCode = generateOpaqueToken()
  const now = new Date()

  // A userCode collision is astronomically rare; the unique index turns it into a retry.
  for (let attempt = 0; ; attempt++) {
    const userCode = newUserCode()

    try {
      await deviceLogins().insertOne({
        _id: hashToken(deviceCode),
        userCodeHash: hashToken(userCode.replace('-', '')),
        status: 'pending',
        clientName,
        ...(input.requesterIp ? { requesterIp: input.requesterIp } : {}),
        createdAt: now,
        expiresAt: new Date(now.getTime() + DEVICE_LOGIN_TTL_SEC * 1000),
      })

      return {
        deviceCode,
        userCode,
        expiresIn: DEVICE_LOGIN_TTL_SEC,
        interval: DEVICE_LOGIN_INTERVAL_SEC,
      }
    } catch (err) {
      if (attempt >= 3 || (err as { code?: number }).code !== 11000) throw err
    }
  }
}

/** The pending request a typed code names, for the approval page to show. */
export async function findPendingDeviceLogin(rawUserCode: unknown) {
  const code = normalizeUserCode(rawUserCode)

  if (!code) return null
  const doc = await deviceLogins().findOne({
    userCodeHash: hashToken(code),
    status: 'pending',
    expiresAt: { $gt: new Date() },
  })

  return doc
    ? {
        clientName: doc.clientName,
        requesterIp: doc.requesterIp ?? null,
        createdAt: doc.createdAt.toISOString(),
        expiresAt: doc.expiresAt.toISOString(),
      }
    : null
}

export type DeviceDecision =
  | { decision: 'deny' }
  | { decision: 'personal' }
  | { decision: 'agent'; name: string; teamId: string; avatarUrl?: string }

/** Pending → approved/denied, once: a replayed approval finds nothing pending. */
export async function decideDeviceLogin(
  rawUserCode: unknown,
  user: NuphosUser,
  decision: DeviceDecision,
) {
  const code = normalizeUserCode(rawUserCode)

  if (!code)
    throw new AppError(400, 'invalid_user_code', 'Enter the 8-letter code your terminal shows')
  if (decision.decision === 'agent' && !(await getTeamMembership(user.id, decision.teamId))) {
    throw new AppError(403, 'forbidden', 'You are not a member of this team')
  }
  const approval =
    decision.decision === 'deny'
      ? undefined
      : decision.decision === 'personal'
        ? { userId: user.id, kind: 'personal' as const, name: '' }
        : {
            userId: user.id,
            kind: 'agent' as const,
            teamId: decision.teamId,
            name: decision.name,
            ...(decision.avatarUrl ? { avatarUrl: decision.avatarUrl } : {}),
          }
  const updated = await deviceLogins().findOneAndUpdate(
    { userCodeHash: hashToken(code), status: 'pending', expiresAt: { $gt: new Date() } },
    approval ? { $set: { status: 'approved', approval } } : { $set: { status: 'denied' } },
    { returnDocument: 'after' },
  )

  if (!updated) throw new AppError(404, 'invalid_user_code', 'This code is wrong or has expired')
}

export type DevicePollResult =
  | { status: 'pending' }
  | { status: 'slow_down' }
  | { status: 'denied' }
  | { status: 'expired' }
  | { status: 'approved'; token: string; user: NuphosUser; cliToken: CliTokenPrincipal }

/**
 * One poll. Faster than the interval is `slow_down` (RFC 8628 §3.5). An
 * approved request is consumed atomically, so exactly one poll gets a token,
 * and the token is minted only then: the collection never holds a credential.
 */
export async function pollDeviceLogin(deviceCode: unknown): Promise<DevicePollResult> {
  if (typeof deviceCode !== 'string' || deviceCode === '') return { status: 'expired' }
  const id = hashToken(deviceCode)
  const now = new Date()
  const doc = await deviceLogins().findOneAndUpdate(
    { _id: id, expiresAt: { $gt: now } },
    { $set: { lastPolledAt: now } },
    { returnDocument: 'before' },
  )

  if (!doc) return { status: 'expired' }
  if (
    doc.lastPolledAt &&
    now.getTime() - doc.lastPolledAt.getTime() < (DEVICE_LOGIN_INTERVAL_SEC - 1) * 1000
  ) {
    return { status: 'slow_down' }
  }
  if (doc.status === 'pending') return { status: 'pending' }
  if (doc.status === 'denied') {
    await deviceLogins().deleteOne({ _id: id })

    return { status: 'denied' }
  }
  const consumed = await deviceLogins().findOneAndDelete({ _id: id, status: 'approved' })
  const approval = consumed?.approval

  if (!approval) return { status: 'expired' }
  const user = await getNuphosUserById(approval.userId)

  if (!user) return { status: 'expired' }
  const { token, principal } = await mintCliToken({
    kind: approval.kind,
    userId: approval.userId,
    ...(approval.kind === 'agent' ? { teamId: approval.teamId } : {}),
    name: approval.kind === 'agent' ? approval.name : doc.clientName,
    ...(approval.avatarUrl ? { avatarUrl: approval.avatarUrl } : {}),
    ...(doc.requesterIp ? { createdIp: doc.requesterIp } : {}),
  })

  return { status: 'approved', token, user, cliToken: principal }
}
