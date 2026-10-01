import { agentConversations } from '@/lib/agent/db'
import { providerCostUsd } from '@/lib/agent/model-pricing'
import { agentTokenUsage } from '@/lib/agent/token-usage'
import { KIND_TOKEN_SUMS } from '@/lib/agent/usage-aggregation'

// One member's spend on a single day.
export type MemberDayUsage = {
  userId: string
  costUsd: number
  totalTokens: number
}

// A day's usage, broken down per member (only members with usage that day).
export type DailyUsagePoint = {
  date: string // YYYY-MM-DD, UTC day boundary
  members: MemberDayUsage[]
}

// A single conversation's spend within a range (for the "by session" list).
export type SessionUsage = {
  sessionId: string
  title: string
  userId: string
  costUsd: number
  totalTokens: number
}

// Top sessions for each selectable range, so the client can switch range
// without a refetch. Keys match the client's range selector.
export type SessionsByRange = {
  '7d': SessionUsage[]
  '14d': SessionUsage[]
  '30d': SessionUsage[]
  mtd: SessionUsage[]
}

// Daily per-member series (for the stacked bar chart, sliced client-side) plus
// per-range top sessions (for the "by session" leaderboard).
export type TeamUsageSeries = {
  days: DailyUsagePoint[]
  sessionsByRange: SessionsByRange
}

// Grouped row: token totals for one bucket. Cost is derived in JS from the
// per-model split. `day`/`sessionId` are present depending on the group key.
type UsageGroupRow = {
  day?: Date
  sessionId?: string
  userId: string
  provider: string
  modelId: string
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  cacheWriteTokens: number
  totalTokens: number
}

const TOP_SESSIONS = 20
const LOOKBACK_DAYS = 31

// UTC midnight `daysAgo` days back (0 = today). Matches the client's calendar-
// day range starts so the lists align with the chart.
function utcDayStart(daysAgo: number): Date {
  const d = new Date()

  d.setUTCHours(0, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() - daysAgo)

  return d
}

function utcMonthStart(): Date {
  const d = new Date()

  d.setUTCDate(1)
  d.setUTCHours(0, 0, 0, 0)

  return d
}

// Fold (session, user, model) rows into per-session totals, price each row, and
// return the top N by cost.
function topSessions(rows: UsageGroupRow[]): Omit<SessionUsage, 'title'>[] {
  const bySession = new Map<string, Omit<SessionUsage, 'title'>>()

  for (const row of rows) {
    const sessionId = row.sessionId

    if (!sessionId) continue
    let session = bySession.get(sessionId)

    if (!session) {
      session = { sessionId, userId: row.userId, costUsd: 0, totalTokens: 0 }
      bySession.set(sessionId, session)
    }
    session.costUsd += providerCostUsd(row) ?? 0
    session.totalTokens += row.totalTokens
  }

  return Array.from(bySession.values())
    .sort((a, b) => b.costUsd - a.costUsd)
    .slice(0, TOP_SESSIONS)
}

export async function getTeamUsageSeries(teamId: string): Promise<TeamUsageSeries> {
  const ranges = {
    '7d': utcDayStart(6),
    '14d': utcDayStart(13),
    '30d': utcDayStart(29),
    mtd: utcMonthStart(),
  }
  const lookbackStart = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
  const since = new Date(
    Math.min(lookbackStart.getTime(), ...Object.values(ranges).map((d) => d.getTime())),
  )

  // Daily per-member series (chart) — one aggregation.
  const dailyRows = await agentTokenUsage()
    .aggregate<UsageGroupRow>([
      { $match: { teamId, createdAt: { $gte: since } } },
      {
        $group: {
          _id: {
            day: { $dateTrunc: { date: '$createdAt', unit: 'day', timezone: 'UTC' } },
            userId: '$userId',
            provider: '$provider',
            modelId: '$modelId',
          },
          ...KIND_TOKEN_SUMS,
        },
      },
      {
        $project: {
          _id: 0,
          day: '$_id.day',
          userId: '$_id.userId',
          provider: '$_id.provider',
          modelId: '$_id.modelId',
          inputTokens: 1,
          cachedInputTokens: 1,
          cacheWriteTokens: 1,
          outputTokens: 1,
          totalTokens: 1,
        },
      },
    ])
    .toArray()

  const byDay = new Map<string, Map<string, MemberDayUsage>>()

  for (const row of dailyRows) {
    if (!row.day) continue
    const date = row.day.toISOString().slice(0, 10)
    let members = byDay.get(date)

    if (!members) {
      members = new Map<string, MemberDayUsage>()
      byDay.set(date, members)
    }
    let member = members.get(row.userId)

    if (!member) {
      member = { userId: row.userId, costUsd: 0, totalTokens: 0 }
      members.set(row.userId, member)
    }
    member.costUsd += providerCostUsd(row) ?? 0
    member.totalTokens += row.totalTokens
  }
  const days: DailyUsagePoint[] = Array.from(byDay.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, members]) => ({ date, members: Array.from(members.values()) }))

  // Per-range top sessions — one faceted aggregation grouped by session.
  const sessionPipeline = (rangeStart: Date) => [
    { $match: { createdAt: { $gte: rangeStart } } },
    {
      $group: {
        _id: {
          sessionId: '$sessionId',
          userId: '$userId',
          provider: '$provider',
          modelId: '$modelId',
        },
        ...KIND_TOKEN_SUMS,
      },
    },
    {
      $project: {
        _id: 0,
        sessionId: '$_id.sessionId',
        userId: '$_id.userId',
        provider: '$_id.provider',
        modelId: '$_id.modelId',
        inputTokens: 1,
        cachedInputTokens: 1,
        cacheWriteTokens: 1,
        outputTokens: 1,
        totalTokens: 1,
      },
    },
  ]
  const [facet] = await agentTokenUsage()
    .aggregate<Record<keyof SessionsByRange, UsageGroupRow[]>>([
      { $match: { teamId, createdAt: { $gte: since } } },
      {
        $facet: {
          '7d': sessionPipeline(ranges['7d']),
          '14d': sessionPipeline(ranges['14d']),
          '30d': sessionPipeline(ranges['30d']),
          mtd: sessionPipeline(ranges.mtd),
        },
      },
    ])
    .toArray()

  const topByRange = {
    '7d': topSessions(facet?.['7d'] ?? []),
    '14d': topSessions(facet?.['14d'] ?? []),
    '30d': topSessions(facet?.['30d'] ?? []),
    mtd: topSessions(facet?.mtd ?? []),
  }

  // Resolve titles for the union of top sessions (≤40 lookups).
  const sessionIds = Array.from(
    new Set(Object.values(topByRange).flatMap((list) => list.map((s) => s.sessionId))),
  )
  const titleById = new Map<string, string>()

  if (sessionIds.length > 0) {
    const convs = await agentConversations()
      .find(
        { sessionId: { $in: sessionIds } },
        { projection: { sessionId: 1, title: 1, firstMessage: 1 } },
      )
      .toArray()

    for (const conv of convs) {
      titleById.set(conv.sessionId, conv.title || conv.firstMessage || 'Untitled chat')
    }
  }

  const withTitles = (list: Omit<SessionUsage, 'title'>[]): SessionUsage[] =>
    list.map((s) => ({ ...s, title: titleById.get(s.sessionId) ?? 'Untitled chat' }))

  return {
    days,
    sessionsByRange: {
      '7d': withTitles(topByRange['7d']),
      '14d': withTitles(topByRange['14d']),
      '30d': withTitles(topByRange['30d']),
      mtd: withTitles(topByRange.mtd),
    },
  }
}
