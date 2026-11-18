// Display names for the ids a usage query groups by, read inside the team.
import { ObjectId } from 'mongodb'

import { agentConversations } from '@/lib/agent/db/shared'
import { agentDevices } from '@/lib/agent/devices/store'
import { agentTriggers } from '@/lib/agent/trigger-db'
import { getTeamMembers } from '@/lib/identity'

import type { UsageDimension, UsageQueryRow } from '@/lib/agent/usage-query'

type ReadNames = (teamId: string, ids: string[], viewerId: string) => Promise<[string, string][]>

/** Names read where the grouped values are ids: people, conversation titles, Trigger names and
 *  computer labels. People who left still name what they sent. */
const NAMED: Partial<Record<UsageDimension, ReadNames>> = {
  member: async (teamId, ids) =>
    (await getTeamMembers(teamId, { includeRemoved: true }))
      .filter((member) => ids.includes(member.id))
      .map((member) => [member.id, member.name || member.email]),
  conversation: conversationTitles,
  bot: conversationTitles,
  task: conversationTitles,
  trigger: async (teamId, ids) =>
    (
      await agentTriggers()
        .find({
          teamId,
          _id: { $in: ids.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id)) },
        })
        .project<{ _id: ObjectId; name: string }>({ name: 1 })
        .toArray()
    ).map((trigger) => [trigger._id.toHexString(), trigger.name]),
  computer: async (teamId, ids) =>
    (
      await agentDevices()
        .find({ teamId, deviceId: { $in: ids } })
        .project<{ deviceId: string; label: string }>({ _id: 0, deviceId: 1, label: 1 })
        .toArray()
    ).map((device) => [device.deviceId, device.label]),
}

async function conversationTitles(
  teamId: string,
  ids: string[],
  viewerId: string,
): Promise<[string, string][]> {
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

  // As in team activity: someone else's private conversation shows that it spent, never what on.
  return conversations.map((c) => [
    c.sessionId,
    c.generalAccess === 'none' && c.userId !== viewerId ? 'Private session' : c.title,
  ])
}

/**
 * A display name for each grouped value the rows hold. The rows are already scoped to what
 * the viewer may see, so only names of their own conversations reach a member.
 */
export async function usageNames(
  teamId: string,
  viewerId: string,
  groupBy: UsageDimension[],
  rows: UsageQueryRow[],
): Promise<Partial<Record<UsageDimension, Record<string, string>>>> {
  const named = await Promise.all(
    groupBy.flatMap((dimension) => {
      const read = NAMED[dimension]
      const ids = [...new Set(rows.flatMap((row) => row.keys[dimension] ?? []))]

      return read && ids.length
        ? [
            read(teamId, ids, viewerId).then(
              (pairs) => [dimension, Object.fromEntries(pairs)] as const,
            ),
          ]
        : []
    }),
  )

  return Object.fromEntries(named)
}
