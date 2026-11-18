// Display names for the ids a usage query groups by, read inside the team.
import { ObjectId } from 'mongodb'

import { canSeeConversationName } from '@/lib/agent/conversation-visibility'
import { agentConversations } from '@/lib/agent/db/shared'
import { agentDevices } from '@/lib/agent/devices/store'
import { agentTriggers } from '@/lib/agent/trigger-db'
import { getTeamMembers } from '@/lib/identity'

import type { UsageDimension, UsageQueryRow } from '@/lib/agent/usage-query'
import type { NuphosTeamRole } from '@/lib/identity/types'

type Viewer = { userId: string; teamRole: NuphosTeamRole }
/** A name, or null where the viewer may not see it. */
type ReadNames = (
  teamId: string,
  ids: string[],
  viewer: Viewer,
) => Promise<[string, string | null][]>

/** Names read where the grouped values are ids: people, conversation titles, Trigger names and
 *  computer labels. People who left still name what they sent. Each name follows who may see
 *  what it names; elsewhere it is null. */
const NAMED: Partial<Record<UsageDimension, ReadNames>> = {
  member: async (teamId, ids) =>
    (await getTeamMembers(teamId, { includeRemoved: true }))
      .filter((member) => ids.includes(member.id))
      .map((member) => [member.id, member.name || member.email]),
  conversation: conversationTitles,
  bot: conversationTitles,
  task: conversationTitles,
  // A Trigger is as visible as the conversation it runs in; one without, to its creator.
  trigger: async (teamId, ids, viewer) => {
    const triggers = await agentTriggers()
      .find({
        teamId,
        _id: { $in: ids.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id)) },
      })
      .project<{ _id: ObjectId; name: string; userId: string; targetSessionId?: string }>({
        name: 1,
        userId: 1,
        targetSessionId: 1,
      })
      .toArray()
    const targets = new Map(
      await conversationTitles(
        teamId,
        triggers.flatMap((trigger) => trigger.targetSessionId ?? []),
        viewer,
      ),
    )

    return triggers.map((trigger) => {
      const seen = trigger.targetSessionId
        ? targets.get(trigger.targetSessionId) != null
        : trigger.userId === viewer.userId || viewer.teamRole === 'ADMINISTRATOR'

      return [trigger._id.toHexString(), seen ? trigger.name : null]
    })
  },
  // A computer is named to an administrator and to the people who may use it.
  computer: async (teamId, ids, viewer) =>
    (
      await agentDevices()
        .find({ teamId, deviceId: { $in: ids } })
        .project<{ deviceId: string; label: string; userId: string; userIds?: string[] }>({
          _id: 0,
          deviceId: 1,
          label: 1,
          userId: 1,
          userIds: 1,
        })
        .toArray()
    ).map((device) => [
      device.deviceId,
      viewer.teamRole === 'ADMINISTRATOR' ||
      device.userId === viewer.userId ||
      (device.userIds ?? []).includes(viewer.userId)
        ? device.label
        : null,
    ]),
}

async function conversationTitles(
  teamId: string,
  ids: string[],
  viewer: Viewer,
): Promise<[string, string | null][]> {
  const conversations = await agentConversations()
    .find({ teamId, sessionId: { $in: ids } })
    .project<{ sessionId: string; title: string; userId: string; generalAccess?: string }>({
      _id: 0,
      sessionId: 1,
      title: 1,
      userId: 1,
      generalAccess: 1,
    })
    .toArray()

  return conversations.map((c) => [c.sessionId, canSeeConversationName(c, viewer) ? c.title : null])
}

/**
 * A display name for each grouped value the rows hold. Every member sees the team's numbers,
 * but another member's Bot, Task or conversation is named only where `canSeeConversationName`
 * allows; elsewhere its name is null.
 */
export async function usageNames(
  teamId: string,
  viewer: Viewer,
  groupBy: UsageDimension[],
  rows: UsageQueryRow[],
): Promise<Partial<Record<UsageDimension, Record<string, string | null>>>> {
  const named = await Promise.all(
    groupBy.flatMap((dimension) => {
      const read = NAMED[dimension]
      const ids = [...new Set(rows.flatMap((row) => row.keys[dimension] ?? []))]

      return read && ids.length
        ? [
            read(teamId, ids, viewer).then(
              (pairs) => [dimension, Object.fromEntries(pairs)] as const,
            ),
          ]
        : []
    }),
  )

  return Object.fromEntries(named)
}
