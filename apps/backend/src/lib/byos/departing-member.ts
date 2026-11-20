import { ObjectId } from 'mongodb'

import { revokeTeamMemberAccess } from '@/lib/agent/devices/local-share-revoke'
import { bindingOwner, isPrivateAccess } from '@/lib/byos/access'
import { logEvent } from '@/lib/observability'
import { teamByosBindings } from '@/models'

import type { BindingAccess } from '@/models'

type Disconnected = { collection: string; bindingId: string }
type Departure = { actorUserId: string; via: 'team_removal' | 'team_leave' }

/** What a member loses on leaving a team or being removed from it. */
export async function revokeDepartedMember(teamId: string, userId: string, by: Departure) {
  await revokeTeamMemberAccess(teamId, userId, by)
  await disconnectDepartedMemberBindings(new ObjectId(teamId), userId, by)
}

/**
 * Disconnects every binding private to a member who has left the team.
 * Nobody else could use them, and only their owner could disconnect them, so
 * they would otherwise stay connected with nobody able to act on them. Each
 * removal applies only while the binding is still private and unchanged, and
 * the result is logged as `byos.binding.disconnected_on_departure`.
 */
export async function disconnectDepartedMemberBindings(
  teamId: ObjectId,
  userId: string,
  by: Departure,
): Promise<Disconnected[]> {
  const doc = await teamByosBindings().findOne({ _id: teamId })
  const disconnected: Disconnected[] = []

  for (const [collection, value] of Object.entries(doc ?? {})) {
    if (!Array.isArray(value)) continue
    for (const binding of value as { id?: unknown; access?: BindingAccess }[]) {
      if (!(binding.id instanceof ObjectId) || !binding.access) continue
      if (bindingOwner(binding.access) !== userId || !isPrivateAccess(binding.access)) continue
      const match = { id: binding.id, 'access.updatedAt': binding.access.updatedAt }
      const result = await teamByosBindings().updateOne(
        { _id: teamId, [collection]: { $elemMatch: match } },
        { $pull: { [collection]: { id: binding.id } }, $set: { updatedAt: new Date() } },
      )

      if (result.modifiedCount > 0) {
        disconnected.push({ collection, bindingId: binding.id.toHexString() })
      }
    }
  }
  if (disconnected.length > 0) {
    logEvent('info', 'byos.binding.disconnected_on_departure', {
      teamId: teamId.toHexString(),
      userId,
      actorUserId: by.actorUserId,
      via: by.via,
      bindings: disconnected,
    })
  }

  return disconnected
}
