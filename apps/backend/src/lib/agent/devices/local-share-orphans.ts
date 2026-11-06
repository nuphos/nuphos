import { logEvent } from '@/lib/observability'

import { dropDeviceShareApprovals, shareApprovals } from './local-share-store'
import { dropDeviceShareTrusts, shareTrusts } from './local-share-trust'
import { agentDevices } from './store'

import type { Collection } from 'mongodb'

/** A computer as both share collections key it: whoever owns it, and its id. */
type DeviceScope = { ownerId: string; deviceId: string }

/** How many computers one lookup asks about, so a large backfill stays a bounded query. */
const LOOKUP_CHUNK = 200

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
 */
export async function dropOrphanedShareState(): Promise<number> {
  const scopes = uniqueScopes([
    ...(await deviceScopes(shareApprovals())),
    ...(await deviceScopes(shareTrusts())),
  ])
  const gone = await goneScopes(scopes)

  for (const { ownerId, deviceId } of gone) {
    await dropDeviceShareApprovals(ownerId, deviceId)
    await dropDeviceShareTrusts(ownerId, deviceId)
  }
  if (gone.length > 0)
    logEvent('info', 'backend.migration.orphaned_device_shares', { computers: gone.length })

  return gone.length
}
