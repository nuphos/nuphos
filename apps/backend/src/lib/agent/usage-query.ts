// The team's token usage over a time range, grouped by and filtered on any of
// the dimensions a usage record carries, priced at list prices on read.
import { providerCostUsd } from '@/lib/agent/model-pricing'
import { agentTokenUsage } from '@/lib/agent/token-usage'
import { KIND_TOKEN_SUMS } from '@/lib/agent/usage-aggregation'
import { AppError } from '@/lib/errors'

// Each dimension as an expression over one usage record. `conversation` is the
// record's own conversation, joined only when a conversation, Bot or Task is asked.
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
  // Desktop 0.130.2 and earlier still ask for `task`; it now means the same as `conversation`.
  // Remove once those releases are gone.
  task: '$sessionId',
} as const

/** Every record in a conversation another member made private, under any conversation grouping. */
export const OTHERS_PRIVATE = 'private:others'

// The dimensions read off the record's own conversation, and so hidden with it.
const CONVERSATION_DIMENSIONS = ['conversation', 'bot', 'task']

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
  /** Whose view: another member's private conversations are one OTHERS_PRIVATE value to them. */
  viewerId: string
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
  /** At list prices; absent when any of the group's models has no known price. */
  costUsd?: number
}

type GroupRow = Omit<UsageQueryRow, 'keys' | 'costUsd'> & {
  _id: Record<string, string | Date | null> & { provider: string; modelId: string }
}

/** The whole team's usage, for any member. Another member's private conversation counts as
 *  OTHERS_PRIVATE under every conversation grouping; `usageNames` decides the other names. */
export async function queryTeamUsage(teamId: string, query: UsageQuery): Promise<UsageQueryRow[]> {
  const { filters } = query
  const used = [...new Set([...query.groupBy, ...(Object.keys(filters) as UsageDimension[])])]
  // Conversation, Bot and Task are read off the conversation, joined once per group, not per record.
  const joined: UsageDimension[] = used.filter((d) => CONVERSATION_DIMENSIONS.includes(d))
  const hidden = {
    $and: [
      { $eq: ['$conversation.generalAccess', 'none'] },
      { $ne: ['$conversation.userId', query.viewerId] },
    ],
  }
  const direct = used.filter((dimension) => !joined.includes(dimension))
  // Each dimension's value as `d_<name>`, then only the records its filter allows.
  const select = (dimensions: UsageDimension[]) =>
    dimensions.length
      ? [
          {
            $set: Object.fromEntries(
              dimensions.map((dimension) => [
                `d_${dimension}`,
                CONVERSATION_DIMENSIONS.includes(dimension)
                  ? { $cond: [hidden, OTHERS_PRIVATE, DIMENSIONS[dimension]] }
                  : DIMENSIONS[dimension],
              ]),
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
      { $match: { teamId, createdAt: { $gte: query.from, $lt: query.to } } },
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
                pipeline: [
                  {
                    $project: {
                      _id: 0,
                      avatar: 1,
                      parentSessionId: 1,
                      generalAccess: 1,
                      userId: 1,
                    },
                  },
                ],
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
    // A group with any unpriced model has no cost, rather than the priced part of it.
    const pricedSoFar = !groups.has(id) || group.costUsd !== undefined

    group.inputTokens += tokens.inputTokens
    group.cachedInputTokens += tokens.cachedInputTokens
    group.cacheWriteTokens += tokens.cacheWriteTokens
    group.outputTokens += tokens.outputTokens
    group.reasoningTokens += tokens.reasoningTokens
    group.totalTokens += tokens.totalTokens
    if (cost !== undefined && pricedSoFar) group.costUsd = (group.costUsd ?? 0) + cost
    else delete group.costUsd
    groups.set(id, group)
  }

  return [...groups.values()]
}
