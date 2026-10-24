import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { agentConversations } from '@/lib/agent/db/shared'
import { AppError } from '@/lib/errors'

import { users, mapUser } from './shared'

import type { BadgeStat, ProfileCharacter } from './types'

export const PROFILE_CHARACTERS = [
  'boy-fringe',
  'boy-side',
  'boy-curly',
  'girl-waves',
  'girl-bangs',
  'girl-pony',
] as const satisfies readonly ProfileCharacter[]

const characterSchema = z.object({ character: z.enum(PROFILE_CHARACTERS).nullable() }).strict()

/** Picks the person's character (look and hairstyle), or clears it with null. */
export async function setProfileCharacter(userId: string, input: unknown) {
  const parsed = characterSchema.safeParse(input)

  if (!parsed.success)
    throw new AppError(400, 'invalid_character', 'Pick one of the six characters')
  const { character } = parsed.data
  const user = await users().findOneAndUpdate(
    { _id: new ObjectId(userId), deletedAt: { $exists: false } },
    character
      ? { $set: { character, updatedAt: new Date() } }
      : { $unset: { character: '' }, $set: { updatedAt: new Date() } },
    { returnDocument: 'after' },
  )

  if (!user) throw new AppError(404, 'user_not_found', 'Your account no longer exists')

  return mapUser(user)
}

/** What the sidebar badge counts, in the order the picker lists them. */
export const BADGE_STATS = [
  'merged-prs',
  'running',
  'waiting',
  'quota',
  'none',
] as const satisfies readonly BadgeStat[]

const badgeStatSchema = z.object({ badgeStat: z.enum(BADGE_STATS) }).strict()

/** Picks what the sidebar badge shows. */
export async function setBadgeStat(userId: string, input: unknown) {
  const parsed = badgeStatSchema.safeParse(input)

  if (!parsed.success) throw new AppError(400, 'invalid_badge_stat', 'Pick one of the badge stats')
  const user = await users().findOneAndUpdate(
    { _id: new ObjectId(userId), deletedAt: { $exists: false } },
    { $set: { badgeStat: parsed.data.badgeStat, updatedAt: new Date() } },
    { returnDocument: 'after' },
  )

  if (!user) throw new AppError(404, 'user_not_found', 'Your account no longer exists')

  return mapUser(user)
}

function validTimeZone(timeZone: string | undefined): string {
  if (!timeZone) return 'UTC'
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })

    return timeZone
  } catch {
    return 'UTC'
  }
}

/** Milliseconds the zone is ahead of UTC at `at`. */
function zoneOffset(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(at))
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value)

  return (
    Date.UTC(
      part('year'),
      part('month') - 1,
      part('day'),
      part('hour'),
      part('minute'),
      part('second'),
    ) -
    Math.floor(at / 1000) * 1000
  )
}

/** The UTC instant of local midnight on the first of `month` (0-based, may overflow) in the zone. */
function monthStart(year: number, month: number, timeZone: string): Date {
  const guess = Date.UTC(year, month, 1)
  const first = guess - zoneOffset(guess, timeZone)

  return new Date(guess - zoneOffset(first, timeZone))
}

/** The calendar month containing `now` in the person's time zone, as UTC instants. */
export function currentMonth(now: Date, timeZone?: string): { start: Date; end: Date } {
  const zone = validTimeZone(timeZone)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(now)
  const year = Number(parts.find((part) => part.type === 'year')?.value)
  const month = Number(parts.find((part) => part.type === 'month')?.value)

  return { start: monthStart(year, month - 1, zone), end: monthStart(year, month, zone) }
}

/**
 * Distinct GitHub PRs linked to sessions the person owns in this team that merged this
 * month. The merge time comes from the PR webhook and link refresh Nuphos already
 * handles; PRs merged before it was recorded carry none and are not counted.
 */
export function mergedPrsPipeline(
  userId: string,
  teamId: string,
  month: { start: Date; end: Date },
) {
  const merged = {
    provider: 'github',
    state: 'merged',
    mergedAt: { $gte: month.start.toISOString(), $lt: month.end.toISOString() },
  }

  return [
    { $match: { userId, teamId, linkedResources: { $elemMatch: merged } } },
    { $project: { _id: 0, linkedResources: 1 } },
    { $unwind: '$linkedResources' },
    {
      $match: Object.fromEntries(
        Object.entries(merged).map(([field, value]) => [`linkedResources.${field}`, value]),
      ),
    },
    { $group: { _id: '$linkedResources.key' } },
    { $count: 'prs' },
  ]
}

export async function countMergedPrs(
  userId: string,
  teamId: string,
  timeZone?: string,
  now = new Date(),
): Promise<{ count: number }> {
  const [row] = await agentConversations()
    .aggregate<{ prs: number }>(mergedPrsPipeline(userId, teamId, currentMonth(now, timeZone)))
    .toArray()

  return { count: row?.prs ?? 0 }
}
