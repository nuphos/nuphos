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
 *  computer labels. People who left still name what they sent; a conversation is named only
 *  where `canSeeConversationName` allows, and is null elsewhere. */
const NAMED: Partial<Record<UsageDimension, ReadNames>> = {
  member: async (teamId, ids) =>
    (await getTeamMembers(teamId, { includeRemoved: true }))
      .filter((member) => ids.includes(member.id))
      .map((member) => [member.id, member.name || member.email]),
  conversation: conversationTitles,
  bot: conversationTitles,
  task: conversationTitles,
  // Triggers and computers are the team's; every member sees their names.
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

/** Stands for every conversation another member made private, in one row. */
export const OTHERS_PRIVATE = 'private:others'
const CONVERSATION_DIMENSIONS: UsageDimension[] = ['conversation', 'bot', 'task']

/**
 * Folds the conversations other members made private into one OTHERS_PRIVATE row per group,
 * so a grouping by conversation, Bot or Task shows none of them apart and totals still add up.
 */
export async function mergeOthersPrivate(
  teamId: string,
  viewer: Viewer,
  groupBy: UsageDimension[],
  rows: UsageQueryRow[],
): Promise<UsageQueryRow[]> {
  const dimensions = groupBy.filter((dimension) => CONVERSATION_DIMENSIONS.includes(dimension))
  const ids = [
    ...new Set(rows.flatMap((row) => dimensions.flatMap((dimension) => row.keys[dimension] ?? []))),
  ]

  if (ids.length === 0) return rows
  const hidden = new Set(
    (
      await agentConversations()
        .find({
          teamId,
          sessionId: { $in: ids },
          generalAccess: 'none',
          userId: { $ne: viewer.userId },
        })
        .project<{ sessionId: string }>({ _id: 0, sessionId: 1 })
        .toArray()
    ).map((conversation) => conversation.sessionId),
  )

  if (hidden.size === 0) return rows
  const merged = new Map<string, UsageQueryRow>()

  for (const row of rows) {
    const keys = Object.fromEntries(
      Object.entries(row.keys).map(([key, value]) => [
        key,
        value && hidden.has(value) ? OTHERS_PRIVATE : value,
      ]),
    )
    const id = JSON.stringify(keys)
    const into = merged.get(id)

    if (!into) {
      merged.set(id, { ...row, keys })
      continue
    }
    into.inputTokens += row.inputTokens
    into.cachedInputTokens += row.cachedInputTokens
    into.cacheWriteTokens += row.cacheWriteTokens
    into.outputTokens += row.outputTokens
    into.reasoningTokens += row.reasoningTokens
    into.totalTokens += row.totalTokens
    if (row.costUsd !== undefined) into.costUsd = (into.costUsd ?? 0) + row.costUsd
  }

  return [...merged.values()]
}
