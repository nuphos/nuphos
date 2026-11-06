import { logError, logEvent } from '@/lib/observability'

import { dropDeviceShareApprovals, shareApprovals } from './local-share-store'
import { dropDeviceShareTrusts, shareTrusts } from './local-share-trust'
import { agentDevices } from './store'

import type { Collection } from 'mongodb'

/** A computer as both share collections key it: whoever owns it, and its id. */
type DeviceScope = { ownerId: string; deviceId: string }

/** How many computers one lookup asks about, so a large backfill stays a bounded query. */
const LOOKUP_CHUNK = 200

/** More computers than this in one run is a wipe, not a backfill, whatever the share. */
export const ORPHAN_DROP_LIMIT = 100

/** Below this many computers, dropping most of them is an ordinary small deployment. */
export const ORPHAN_SHARE_FLOOR = 10

/** Whether dropping this many is over half of what it looked at, from the floor up. */
export function overShare(dropping: number, total: number): boolean {
  return total >= ORPHAN_SHARE_FLOOR && dropping * 2 > total
}

const scopeKey = (scope: DeviceScope) => `${scope.ownerId}/${scope.deviceId}`

/** Each computer once: one both collections hold rows for is still one computer. */
const uniqueScopes = (scopes: DeviceScope[]): DeviceScope[] => [
  ...new Map(scopes.map((scope) => [scopeKey(scope), scope])).values(),
]

/** The computers a share collection still holds rows for. */
async function deviceScopes<T extends DeviceScope>(
  collection: Collection<T>,
): Promise<DeviceScope[]> {
  const rows = await collection
    .aggregate<{ _id: DeviceScope }>([
      { $group: { _id: { ownerId: '$ownerId', deviceId: '$deviceId' } } },
    ])
    .toArray()

  return rows.map((row) => row._id)
}

/** Those of them that are no longer registered. */
async function goneScopes(scopes: DeviceScope[]): Promise<DeviceScope[]> {
  const gone: DeviceScope[] = []

  // Asked in chunks, so no one lookup carries an unbounded $or.
  for (let at = 0; at < scopes.length; at += LOOKUP_CHUNK) {
    const chunk = scopes.slice(at, at + LOOKUP_CHUNK)
    const registered = await agentDevices()
      .find(
        { $or: chunk.map(({ ownerId, deviceId }) => ({ userId: ownerId, deviceId })) },
        { projection: { userId: 1, deviceId: 1 } },
      )
      .toArray()
    const live = new Set(
      registered.map((device) => scopeKey({ ownerId: device.userId, deviceId: device.deviceId })),
    )

    gone.push(...chunk.filter((scope) => !live.has(scopeKey(scope))))
  }

  return gone
}

/**
 * Drops approvals and trusts about computers that are gone. A delete forgets them
 * as it goes; this is for the ones deleted before it did, whose id a machine
 * registering again would otherwise inherit. Idempotent: a scope with nothing
 * left matches nothing, and a registered computer is never looked at.
 *
 * It deletes for good, on every boot, so it only does so when the registry it
 * judges them against can be believed: nothing when no computer is registered,
 * nothing when that read fails, and nothing when the answer would wipe most of
 * what it sees. Each of those is logged with the numbers behind it.
 */
export async function dropOrphanedShareState(): Promise<number> {
  const scopes = uniqueScopes([
    ...(await deviceScopes(shareApprovals())),
    ...(await deviceScopes(shareTrusts())),
  ])

  if (scopes.length === 0) return 0
  let gone: DeviceScope[]

  try {
    // An empty registry is a restore, a wrong database or a migration half done, not
    // a deployment where every computer left: nothing here is safe to judge.
    if ((await agentDevices().countDocuments({}, { limit: 1 })) === 0) {
      logEvent('warn', 'backend.migration.device_share_orphans_skipped', {
        reason: 'no_devices',
        scopes: scopes.length,
      })

      return 0
    }
    gone = await goneScopes(scopes)
  } catch (error) {
    logError('backend.migration.device_share_orphans_failed', error, { scopes: scopes.length })

    return 0
  }

  if (gone.length === 0) return 0
  if (gone.length > ORPHAN_DROP_LIMIT || overShare(gone.length, scopes.length)) {
    logEvent('error', 'backend.migration.device_share_orphans_refused', {
      would_drop: gone.length,
      scopes: scopes.length,
    })

    return 0
  }
  logEvent('info', 'backend.migration.device_share_orphans', {
    would_drop: gone.length,
    scopes: scopes.length,
  })

  for (const { ownerId, deviceId } of gone) {
    await dropDeviceShareApprovals(ownerId, deviceId)
    await dropDeviceShareTrusts(ownerId, deviceId)
  }

  return gone.length
}
