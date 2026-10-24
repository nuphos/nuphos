import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { ObjectId } from 'mongodb'

import {
  BADGE_STATS,
  countMergedPrs,
  currentMonth,
  mergedPrsPipeline,
  setBadgeStat,
  setProfileCharacter,
} from './character'
import * as profile from './character'

import { useDb } from '@/lib/test/doubles/db'

const id = new ObjectId()
let update: { filter: unknown; values: unknown } | undefined
let pipeline: unknown
let prs: number | undefined = 4

useDb({
  db: () => ({
    collection: (name: string) => ({
      findOneAndUpdate: async (filter: unknown, values: unknown) => {
        update = { filter, values }
        const set = (values as { $set: { character?: string; badgeStat?: string } }).$set

        return {
          _id: id,
          email: 'alice@example.com',
          name: 'Alice',
          username: 'alice',
          avatarURL: '',
          language: 'en',
          createdAt: new Date(),
          ...(set.character ? { character: set.character } : {}),
          ...(set.badgeStat ? { badgeStat: set.badgeStat } : {}),
        }
      },
      aggregate: (stages: unknown) => {
        if (name === 'agent_conversations') pipeline = stages

        return { toArray: async () => (prs === undefined ? [] : [{ prs }]) }
      },
    }),
  }),
})

test("the month runs from local midnight on the 1st, in the person's time zone", () => {
  const now = new Date('2026-10-24T03:00:00Z')

  expect(currentMonth(now, 'UTC')).toEqual({
    start: new Date('2026-10-01T00:00:00Z'),
    end: new Date('2026-11-01T00:00:00Z'),
  })
  // Still October 23rd in Los Angeles; PDT in October, PST from November 1st.
  expect(currentMonth(now, 'America/Los_Angeles')).toEqual({
    start: new Date('2026-10-01T07:00:00Z'),
    end: new Date('2026-11-01T07:00:00Z'),
  })
  // Already November 1st in Tokyo while it is still October in UTC.
  expect(currentMonth(new Date('2026-10-31T16:00:00Z'), 'Asia/Tokyo').start).toEqual(
    new Date('2026-10-31T15:00:00Z'),
  )
  expect(currentMonth(now, 'Mars/Olympus').start).toEqual(new Date('2026-10-01T00:00:00Z'))
})

test("PRs merged this month count distinct linked PRs in the person's own sessions in this team", async () => {
  prs = 4
  const team = new ObjectId().toHexString()

  expect(await countMergedPrs('u1', team, 'UTC', new Date('2026-10-24T03:00:00Z'))).toEqual({
    count: 4,
  })
  expect(pipeline).toEqual(
    mergedPrsPipeline('u1', team, currentMonth(new Date('2026-10-24T03:00:00Z'), 'UTC')),
  )
  const [match, project, , unwound, group] = pipeline as [
    { $match: Record<string, unknown> },
    { $project: Record<string, number> },
    unknown,
    { $match: Record<string, unknown> },
    { $group: { _id: string } },
  ]
  const merged = {
    provider: 'github',
    state: 'merged',
    mergedAt: { $gte: '2026-10-01T00:00:00.000Z', $lt: '2026-11-01T00:00:00.000Z' },
  }

  // Owner and team scope, served by { userId, 'linkedResources.mergedAt' }.
  expect(match.$match).toEqual({
    userId: 'u1',
    teamId: team,
    linkedResources: { $elemMatch: merged },
  })
  expect(project.$project).toEqual({ _id: 0, linkedResources: 1 })
  expect(unwound.$match).toEqual({
    'linkedResources.provider': 'github',
    'linkedResources.state': 'merged',
    'linkedResources.mergedAt': merged.mergedAt,
  })
  // One PR linked to two sessions counts once.
  expect(group.$group._id).toBe('$linkedResources.key')
  prs = undefined
  expect(await countMergedPrs('u1', team)).toEqual({ count: 0 })
})

test('a person picks what the badge shows, and nothing else is accepted', async () => {
  expect(BADGE_STATS).toEqual(['merged-prs', 'running', 'waiting', 'quota', 'none'])
  const picked = await setBadgeStat(id.toHexString(), { badgeStat: 'waiting' })

  expect(picked.badgeStat).toBe('waiting')
  expect(update?.values).toEqual({ $set: { badgeStat: 'waiting', updatedAt: expect.any(Date) } })
  for (const input of [
    { badgeStat: 'xp' },
    { badgeStat: 'failing-ci' },
    { badgeStat: 'none', x: 1 },
    null,
  ]) {
    await expect(setBadgeStat(id.toHexString(), input)).rejects.toMatchObject({
      status: 400,
      code: 'invalid_badge_stat',
    })
  }
})

test('no XP or level code is left', () => {
  const routes = Object.keys(
    JSON.parse(readFileSync(new URL('../../routes/route-access.json', import.meta.url), 'utf8')),
  )

  expect(routes).not.toContain('GET /auth/me/level')
  expect(routes).toContain('GET /auth/me/merged-prs')
  expect(Object.keys(profile)).not.toEqual(
    expect.arrayContaining([expect.stringMatching(/level|xp|activeDays/i)]),
  )
})

test('a person picks one of the six characters, can clear it, and nothing else is accepted', async () => {
  const picked = await setProfileCharacter(id.toHexString(), { character: 'girl-pony' })

  expect(picked.character).toBe('girl-pony')
  expect(update?.filter).toEqual({ _id: id, deletedAt: { $exists: false } })
  expect(update?.values).toEqual({ $set: { character: 'girl-pony', updatedAt: expect.any(Date) } })

  const cleared = await setProfileCharacter(id.toHexString(), { character: null })

  expect(cleared.character).toBeUndefined()
  expect(update?.values).toEqual({
    $unset: { character: '' },
    $set: { updatedAt: expect.any(Date) },
  })

  for (const input of [
    { character: 'dragon' },
    { character: 'boy' },
    { character: 'boy-fringe', name: 'x' },
    null,
    {},
  ]) {
    await expect(setProfileCharacter(id.toHexString(), input)).rejects.toMatchObject({
      status: 400,
      code: 'invalid_character',
    })
  }
})
