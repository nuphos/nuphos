import { randomUUID } from 'node:crypto'

import { db } from '@/lib/db'

import type { Collection } from 'mongodb'

/** How long an owner trusts a teammate on their computer: their conversations run without asking. */
export const SHARE_TRUST_DURATIONS = ['8h', 'always'] as const
export type ShareTrustDuration = (typeof SHARE_TRUST_DURATIONS)[number]

const TRUST_HOURS: Record<Exclude<ShareTrustDuration, 'always'>, number> = { '8h': 8 }

/** A teammate whose conversations run on an owner's computer without asking, until it expires. */
export type ShareTrust = {
  _id: string
  ownerId: string
  deviceId: string
  teamId: string
  actorId: string
  /** Absent when the owner trusts them until they take it back. */
  expiresAt?: Date
  createdAt: Date
}

export const shareTrusts = (): Collection<ShareTrust> =>
  db().collection<ShareTrust>('agent_device_share_trusts')

export async function setupShareTrustIndexes(): Promise<void> {
  await shareTrusts().createIndex(
    { ownerId: 1, deviceId: 1, teamId: 1, actorId: 1 },
    { unique: true, name: 'share_trust_unique' },
  )
  // An expired trust goes on its own; one without expiresAt stays until it is taken back.
  await shareTrusts().createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0, name: 'share_trust_expiry' },
  )
}

/** When a trust given now ends; undefined for one that does not. */
export function shareTrustExpiry(duration: ShareTrustDuration, now: Date): Date | undefined {
  return duration === 'always'
    ? undefined
    : new Date(now.getTime() + TRUST_HOURS[duration] * 60 * 60 * 1000)
}

type TrustKey = { ownerId: string; deviceId: string; teamId: string; actorId: string }

/** Trusts this teammate on this computer; a newer answer replaces an older one. */
export async function trustTeammate(
  key: TrustKey & { duration: ShareTrustDuration },
  now: Date = new Date(),
): Promise<void> {
  const { duration, ...match } = key
  const expiresAt = shareTrustExpiry(duration, now)

  await shareTrusts().updateOne(
    match,
    {
      $set: { createdAt: now, ...(expiresAt ? { expiresAt } : {}) },
      ...(expiresAt ? {} : { $unset: { expiresAt: '' as const } }),
      $setOnInsert: { _id: randomUUID() },
    },
    { upsert: true },
  )
}

/** The expiry index sweeps about once a minute, so an expired trust is checked here too. */
const live = (now: Date) => ({
  $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }],
})

export async function isShareTrusted(key: TrustKey, now: Date = new Date()): Promise<boolean> {
  return (await shareTrusts().countDocuments({ ...key, ...live(now) }, { limit: 1 })) > 0
}

/** Who the owner trusts on this computer in this team, soonest to expire last. */
export async function listShareTrusts(
  ownerId: string,
  deviceId: string,
  teamId: string,
  now: Date = new Date(),
): Promise<ShareTrust[]> {
  return shareTrusts()
    .find({ ownerId, deviceId, teamId, ...live(now) })
    .sort({ createdAt: -1 })
    .limit(500)
    .toArray()
}

/** Takes the trust back from these people on this computer, or from everyone. */
export async function dropShareTrusts(
  ownerId: string,
  deviceId: string,
  teamId: string,
  actorIds?: string[],
): Promise<void> {
  await shareTrusts().deleteMany({
    ownerId,
    deviceId,
    teamId,
    ...(actorIds ? { actorId: { $in: actorIds } } : {}),
  })
}

/** Trusts a person gave or was given in this team, so none carries over if they rejoin. */
export async function dropMemberShareTrusts(teamId: string, userId: string): Promise<void> {
  await shareTrusts().deleteMany({ teamId, $or: [{ actorId: userId }, { ownerId: userId }] })
}
