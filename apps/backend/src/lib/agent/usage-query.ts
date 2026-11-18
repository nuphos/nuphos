// The team's token usage over a time range, grouped by and filtered on any of
// the dimensions a usage record carries, priced at list prices on read.
import { ObjectId } from 'mongodb'

import { agentConversations } from '@/lib/agent/db/shared'
import { agentDevices } from '@/lib/agent/devices/store'
import { providerCostUsd } from '@/lib/agent/model-pricing'
import { agentTokenUsage } from '@/lib/agent/token-usage'
import { agentTriggers } from '@/lib/agent/trigger-db'
import { KIND_TOKEN_SUMS } from '@/lib/agent/usage-aggregation'
import { AppError } from '@/lib/errors'

import type { NuphosTeamRole } from '@/lib/identity/types'

// Each dimension as an expression over one usage record. `conversation` is the
// record's own conversation, joined only when a Bot or Task dimension is asked.
const DIMENSIONS = {
  // The sender; rows from before senders were recorded fall back to the owner.
  member: { $ifNull: ['$actorUserId', '$userId'] },
  model: '$modelId',
  provider: '$provider',
  runtime: '$runtimeId',
  computer: '$deviceId',
  trigger: '$triggerId',
  source: '$turnSource',
  outcome: '$finishReason',
  conversation: '$sessionId',
  // A conversation with an avatar is a Bot; a Task speaks for the one above it.
  bot: {
    $cond: [
      { $ifNull: ['$conversation.avatar', false] },
      '$sessionId',
      '$conversation.parentSessionId',
    ],
  },
  task: {
    $cond: [
      { $and: [{ $not: ['$conversation.avatar'] }, '$conversation.parentSessionId'] },
      '$sessionId',
      null,
    ],
  },
} as const

export type UsageDimension = keyof typeof DIMENSIONS
export const USAGE_DIMENSIONS = Object.keys(DIMENSIONS) as [UsageDimension, ...UsageDimension[]]
export const USAGE_BUCKETS = ['hour', 'day', 'week'] as const

// Groups read before the models are folded; a wider query is refused, not truncated.
const MAX_GROUPS = 5000

export type UsageQuery = {
  from: Date
  to: Date
  bucket?: (typeof USAGE_BUCKETS)[number]
  timeZone?: string
  groupBy: UsageDimension[]
  filters: Partial<Record<UsageDimension, string[]>>
}

export type UsageQueryRow = {
  /** The bucket's start, when bucketed, and each grouped dimension's value (null = not recorded). */
  keys: Partial<Record<UsageDimension | 'time', string | null>>
  inputTokens: number
  cachedInputTokens: number
  cacheWriteTokens: number
  outputTokens: number
  reasoningTokens: number
  totalTokens: number
  /** At list prices; absent when none of the group's models has a known price. */
  costUsd?: number
}

type GroupRow = Omit<UsageQueryRow, 'keys' | 'costUsd'> & {
  _id: Record<string, string | Date | null> & { provider: string; modelId: string }
}

/**
 * An admin queries the whole team. Anyone else sees only their own
 * conversations' usage, as `/usage` shows it, whoever sent the turns.
 */
export async function queryTeamUsage(
  teamId: string,
  viewer: { userId: string; teamRole: NuphosTeamRole },
  query: UsageQuery,
): Promise<UsageQueryRow[]> {
  const { filters } = query
  const own = viewer.teamRole === 'ADMINISTRATOR' ? {} : { userId: viewer.userId }
  const used = [...new Set([...query.groupBy, ...(Object.keys(filters) as UsageDimension[])])]
  // Bot and Task are read off the conversation, joined once per group, not per record.
  const joined: UsageDimension[] = used.filter((d) => d === 'bot' || d === 'task')
  const direct = used.filter((dimension) => !joined.includes(dimension))
  // Each dimension's value as `d_<name>`, then only the records its filter allows.
  const select = (dimensions: UsageDimension[]) =>
    dimensions.length
      ? [
          {
            $set: Object.fromEntries(
              dimensions.map((dimension) => [`d_${dimension}`, DIMENSIONS[dimension]]),
            ),
          },
          {
            $match: Object.fromEntries(
              dimensions.flatMap((dimension) =>
                filters[dimension] ? [[`d_${dimension}`, { $in: filters[dimension] }]] : [],
              ),
            ),
          },
        ]
      : []
  const grouped = query.groupBy.filter((dimension) => joined.includes(dimension))
  const time = query.bucket
    ? {
        $dateTrunc: {
          date: '$createdAt',
          unit: query.bucket,
          ...(query.timeZone ? { timezone: query.timeZone } : {}),
        },
      }
    : null
  const rows = await agentTokenUsage()
    .aggregate<GroupRow>([
      { $match: { teamId, ...own, createdAt: { $gte: query.from, $lt: query.to } } },
      ...select(direct),
      {
        $group: {
          _id: {
            ...Object.fromEntries(
              query.groupBy
                .filter((dimension) => direct.includes(dimension))
                .map((dimension) => [dimension, `$d_${dimension}`]),
            ),
            ...(joined.length ? { sessionId: '$sessionId' } : {}),
            ...(time ? { time } : {}),
            provider: '$provider',
            modelId: '$modelId',
          },
          ...KIND_TOKEN_SUMS,
          reasoningTokens: {
            $sum: {
              $cond: [
                { $eq: ['$kind', 'thinking'] },
                { $ifNull: ['$tokens.reasoningTokens', 0] },
                0,
              ],
            },
          },
        },
      },
      ...(joined.length
        ? [
            { $set: { sessionId: '$_id.sessionId' } },
            {
              $lookup: {
                from: 'agent_conversations',
                localField: 'sessionId',
                foreignField: 'sessionId',
                pipeline: [{ $project: { _id: 0, avatar: 1, parentSessionId: 1 } }],
                as: 'conversation',
              },
            },
            { $set: { conversation: { $first: '$conversation' } } },
            ...select(joined),
            ...(grouped.length
              ? [
                  {
                    $set: Object.fromEntries(
                      grouped.map((dimension) => [`_id.${dimension}`, `$d_${dimension}`]),
                    ),
                  },
                ]
              : []),
          ]
        : []),
      { $limit: MAX_GROUPS + 1 },
    ])
    .toArray()

  if (rows.length > MAX_GROUPS)
    throw new AppError(
      400,
      'invalid_request',
      'This query has too many groups; narrow its range, bucket or dimensions',
    )

  return foldModels(rows, query.groupBy)
}

/** Names read where the grouped values are ids: conversation titles, Trigger names, computer labels. */
const NAMED: Partial<
  Record<UsageDimension, (teamId: string, ids: string[]) => Promise<[string, string][]>>
> = {
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

async function conversationTitles(teamId: string, ids: string[]): Promise<[string, string][]> {
  const conversations = await agentConversations()
    .find({ teamId, sessionId: { $in: ids } })
    .project<{ sessionId: string; title: string }>({ _id: 0, sessionId: 1, title: 1 })
    .toArray()

  return conversations.map((conversation) => [conversation.sessionId, conversation.title])
}

/**
 * A display name for each grouped value the rows hold. The rows are already scoped to what
 * the viewer may see, so only names of their own conversations reach a member.
 */
export async function usageNames(
  teamId: string,
  groupBy: UsageDimension[],
  rows: UsageQueryRow[],
): Promise<Partial<Record<UsageDimension, Record<string, string>>>> {
  const named = await Promise.all(
    groupBy.flatMap((dimension) => {
      const read = NAMED[dimension]
      const ids = [...new Set(rows.flatMap((row) => row.keys[dimension] ?? []))]

      return read && ids.length
        ? [read(teamId, ids).then((pairs) => [dimension, Object.fromEntries(pairs)] as const)]
        : []
    }),
  )

  return Object.fromEntries(named)
}

// Price each model's tokens, then fold the models into the groups asked for.
function foldModels(rows: GroupRow[], groupBy: UsageDimension[]): UsageQueryRow[] {
  const groups = new Map<string, UsageQueryRow>()

  for (const { _id, ...tokens } of rows) {
    const keys: UsageQueryRow['keys'] = Object.fromEntries(
      [...(_id.time ? ['time'] : []), ...groupBy].map((key) => {
        const value = _id[key]

        return [key, value instanceof Date ? value.toISOString() : (value ?? null)]
      }),
    )
    const id = JSON.stringify(keys)
    const group = groups.get(id) ?? {
      keys,
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
    }
    const cost = providerCostUsd({ ..._id, ...tokens })

    group.inputTokens += tokens.inputTokens
    group.cachedInputTokens += tokens.cachedInputTokens
    group.cacheWriteTokens += tokens.cacheWriteTokens
    group.outputTokens += tokens.outputTokens
    group.reasoningTokens += tokens.reasoningTokens
    group.totalTokens += tokens.totalTokens
    if (cost !== undefined) group.costUsd = (group.costUsd ?? 0) + cost
    groups.set(id, group)
  }

  return [...groups.values()]
}
