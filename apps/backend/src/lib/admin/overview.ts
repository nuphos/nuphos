import { ObjectId } from 'mongodb'

import { agentConversations } from '@/lib/agent/db'
import { teams, users } from '@/lib/identity/shared'

import type { Collection, Document, Filter } from 'mongodb'

const DAY_MS = 86_400_000
const TREND_DAYS = 30
const CACHE_MS = 60_000

export type OverviewWindows = {
  today: number
  last7d: number
  last30d: number
}

export type OverviewActiveWindows = {
  last24h: number
  last7d: number
  last30d: number
}

export type OverviewTrendPoint = {
  date: string
  newUsers: number
  newWorkspaces: number
  firstAgentUsers: number
}

export type AdminOverview = {
  generatedAt: string
  timezone: 'UTC'
  users: OverviewWindows & { total: number }
  workspaces: OverviewWindows & { total: number }
  firstAgentUsers: OverviewWindows
  activeAgentWorkspaces: OverviewActiveWindows
  trend: OverviewTrendPoint[]
}

type DailyCount = { date: string; count: number }
type FirstAgentUser = { userId: string; firstAt: Date }

let cached: { expiresAt: number; value: AdminOverview } | null = null
let inFlight: Promise<AdminOverview> | null = null

export async function getAdminOverview(now = new Date()): Promise<AdminOverview> {
  if (cached && cached.expiresAt > now.getTime()) return cached.value
  if (inFlight) return inFlight

  inFlight = loadAdminOverview(now).then((value) => {
    cached = { expiresAt: Date.now() + CACHE_MS, value }

    return value
  })

  try {
    return await inFlight
  } finally {
    inFlight = null
  }
}

export function resetAdminOverviewCacheForTest(): void {
  cached = null
  inFlight = null
}

async function loadAdminOverview(now: Date): Promise<AdminOverview> {
  const today = startOfUtcDay(now)
  const last7d = addUtcDays(today, -6)
  const last30d = addUtcDays(today, -(TREND_DAYS - 1))
  const [
    userCounts,
    workspaceCounts,
    userTrend,
    workspaceTrend,
    firstAgentUsers,
    activeAgentWorkspaces,
  ] = await Promise.all([
    identityWindows(users(), { deletedAt: { $exists: false } }, today, last7d, last30d),
    identityWindows(teams(), { deletedAt: { $exists: false } }, today, last7d, last30d),
    dailyIdentityCounts(users(), { deletedAt: { $exists: false } }, last30d),
    dailyIdentityCounts(teams(), { deletedAt: { $exists: false } }, last30d),
    listFirstAgentUsers(last30d),
    activeWorkspaceWindows(now),
  ])
  const firstAgentWindows = windowCounts(
    firstAgentUsers.map((row) => row.firstAt),
    today,
    last7d,
    last30d,
  )
  const trend = mergeTrend(
    last30d,
    TREND_DAYS,
    userTrend,
    workspaceTrend,
    firstAgentUsers.map((row) => ({ date: dateKey(row.firstAt), count: 1 })),
  )

  return {
    generatedAt: now.toISOString(),
    timezone: 'UTC',
    users: userCounts,
    workspaces: workspaceCounts,
    firstAgentUsers: firstAgentWindows,
    activeAgentWorkspaces,
    trend,
  }
}

async function identityWindows<T extends Document>(
  collection: Collection<T>,
  base: Filter<T>,
  today: Date,
  last7d: Date,
  last30d: Date,
): Promise<OverviewWindows & { total: number }> {
  const threshold = (date: Date): Filter<T> => ({ ...base, _id: { $gte: objectIdSince(date) } })
  const [total, todayCount, last7dCount, last30dCount] = await Promise.all([
    collection.countDocuments(base),
    collection.countDocuments(threshold(today)),
    collection.countDocuments(threshold(last7d)),
    collection.countDocuments(threshold(last30d)),
  ])

  return { total, today: todayCount, last7d: last7dCount, last30d: last30dCount }
}

async function dailyIdentityCounts<T extends Document>(
  collection: Collection<T>,
  base: Document,
  since: Date,
): Promise<DailyCount[]> {
  return collection
    .aggregate<DailyCount>([
      { $match: { ...base, _id: { $gte: objectIdSince(since) } } },
      {
        $group: {
          _id: { $dateToString: { date: '$createdAt', format: '%Y-%m-%d', timezone: 'UTC' } },
          count: { $sum: 1 },
        },
      },
      { $project: { _id: 0, date: '$_id', count: 1 } },
    ])
    .toArray()
}

/**
 * Activation means a user's first-ever Agent conversation. Only recent
 * candidates are loaded; the self-lookup uses the userId+createdAt index to
 * reject anyone who already had an older conversation.
 */
async function listFirstAgentUsers(since: Date): Promise<FirstAgentUser[]> {
  return agentConversations()
    .aggregate<FirstAgentUser>([
      {
        $match: {
          _id: { $gte: objectIdSince(since) },
          userId: { $type: 'string', $ne: '' },
        },
      },
      { $group: { _id: '$userId', firstAt: { $min: '$createdAt' } } },
      {
        $lookup: {
          from: 'agent_conversations',
          let: { candidateUserId: '$_id', candidateAt: '$firstAt' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$userId', '$$candidateUserId'] },
                    { $lt: ['$createdAt', '$$candidateAt'] },
                  ],
                },
              },
            },
            { $limit: 1 },
          ],
          as: 'earlier',
        },
      },
      { $match: { 'earlier.0': { $exists: false } } },
      { $project: { _id: 0, userId: '$_id', firstAt: 1 } },
    ])
    .toArray()
}

async function activeWorkspaceWindows(now: Date): Promise<OverviewActiveWindows> {
  const count = async (since: Date): Promise<number> => {
    const [row] = await agentConversations()
      .aggregate<{ count: number }>([
        {
          $match: {
            lastActiveAt: { $gte: since },
            teamId: { $type: 'string', $ne: '' },
          },
        },
        { $group: { _id: '$teamId' } },
        { $count: 'count' },
      ])
      .toArray()

    return row?.count ?? 0
  }

  const [last24h, last7d, last30d] = await Promise.all([
    count(new Date(now.getTime() - DAY_MS)),
    count(new Date(now.getTime() - 7 * DAY_MS)),
    count(new Date(now.getTime() - 30 * DAY_MS)),
  ])

  return { last24h, last7d, last30d }
}

export function mergeTrend(
  start: Date,
  days: number,
  usersByDay: DailyCount[],
  workspacesByDay: DailyCount[],
  firstAgentUsersByDay: DailyCount[],
): OverviewTrendPoint[] {
  const toMap = (rows: DailyCount[]): Map<string, number> => {
    const result = new Map<string, number>()

    for (const row of rows) result.set(row.date, (result.get(row.date) ?? 0) + row.count)

    return result
  }
  const usersMap = toMap(usersByDay)
  const workspacesMap = toMap(workspacesByDay)
  const firstAgentMap = toMap(firstAgentUsersByDay)

  return Array.from({ length: days }, (_, index) => {
    const date = dateKey(addUtcDays(start, index))

    return {
      date,
      newUsers: usersMap.get(date) ?? 0,
      newWorkspaces: workspacesMap.get(date) ?? 0,
      firstAgentUsers: firstAgentMap.get(date) ?? 0,
    }
  })
}

export function windowCounts(
  dates: Date[],
  today: Date,
  last7d: Date,
  last30d: Date,
): OverviewWindows {
  return {
    today: dates.filter((date) => date >= today).length,
    last7d: dates.filter((date) => date >= last7d).length,
    last30d: dates.filter((date) => date >= last30d).length,
  }
}

function objectIdSince(date: Date): ObjectId {
  return ObjectId.createFromTime(Math.floor(date.getTime() / 1000))
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS)
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}
