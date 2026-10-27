import { beforeEach, describe, expect, test } from 'bun:test'

import {
  LIVE_ACTIVITY_DISMISS_S,
  LIVE_ACTIVITY_RETRY_MS,
  liveActivityPhase,
  recordLiveActivityPhase,
  registerLiveActivityToken,
} from './live-activities'

import type { ApnsRequest, ApnsResponse } from './apns'
import type {
  LiveActivityDeps,
  LiveActivityPhase,
  LiveActivitySession,
  LiveActivityStore,
  LiveActivityToken,
} from './live-activities'

let sessions: Map<string, LiveActivitySession>
let sent: ApnsRequest[]
let responses: Record<string, ApnsResponse | Error>
let scheduled: { work: () => void; delayMs: number }[]
let clock: number

const token = (name: string): LiveActivityToken => ({
  token: name,
  userId: 'viewer',
  environment: 'production',
})
const row = (title: string) => ({ teamId: 'team-1', title })
const tokensOf = (sessionId: string) => sessions.get(sessionId)?.tokens.map((t) => t.token) ?? []
const copy = (s: LiveActivitySession) => ({ ...s, tokens: [...s.tokens] })
const card = (rows: [string, string, LiveActivityPhase][], active: number, more = 0) => ({
  sessions: rows.map(([id, title, phase]) => ({ id, teamId: 'team-1', title, phase })),
  more,
  active,
})
const contentOf = (deviceToken: string) =>
  (sent.findLast((r) => r.deviceToken === deviceToken)?.payload as { aps: Record<string, unknown> })
    .aps

// Mirrors the Mongo store: version-ordered phases, a run's start only
// touches a session that already exists, and newer writes sort first.
const store: LiveActivityStore = {
  async setPhase(sessionId, phase, version) {
    const current = sessions.get(sessionId)

    if (current?.version !== undefined && current.version >= version) return null
    if (!current && phase === 'running') return null
    const next = { tokens: [], ...current, sessionId, phase, version, updatedAt: new Date(++clock) }

    sessions.set(sessionId, next)

    return copy(next)
  },
  async addToken(sessionId, added, cardRow) {
    const current = sessions.get(sessionId) ?? { sessionId, tokens: [], updatedAt: new Date(0) }
    const next = {
      ...current,
      ...cardRow,
      tokens: [...current.tokens.filter((t) => t.token !== added.token), added],
      updatedAt: new Date(++clock),
    }

    sessions.set(sessionId, next)

    return copy(next)
  },
  async removeToken(removed) {
    for (const s of sessions.values()) s.tokens = s.tokens.filter((t) => t.token !== removed)
  },
  async get(sessionId) {
    const current = sessions.get(sessionId)

    return current ? copy(current) : null
  },
  async forToken(listed) {
    return [...sessions.values()]
      .filter((s) => s.tokens.some((t) => t.token === listed))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map(copy)
  },
}

const deps: LiveActivityDeps = {
  credentials: () => ({
    keyId: 'K',
    teamId: 'T',
    bundleId: 'ai.nuphos.ios',
    privateKey: 'unused',
    environment: 'production',
  }),
  liveActivities: store,
  send: async (_credentials, request) => {
    sent.push(request)
    const response = responses[request.deviceToken]

    if (response instanceof Error) throw response

    return response ?? { status: 200 }
  },
  now: () => 100_000,
  schedule: (work, delayMs) => {
    scheduled.push({ work, delayMs })
  },
}

async function runScheduled() {
  const pending = scheduled

  scheduled = []
  for (const { work } of pending) work()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(async () => {
  sessions = new Map()
  sent = []
  responses = {}
  scheduled = []
  clock = 0
  await store.addToken('session-1', token('la-1'), row('One'))
  await store.addToken('session-1', token('la-2'), row('One'))
  await store.addToken('session-2', token('la-other'), row('Two'))
})

describe('Live Activity pushes', () => {
  test('a finished turn ends a card with nothing else running', async () => {
    await recordLiveActivityPhase(deps, 'session-1', 'done', 10)

    expect(sent.map((r) => r.deviceToken)).toEqual(['la-1', 'la-2'])
    expect(sent[0]).toEqual({
      deviceToken: 'la-1',
      environment: 'production',
      pushType: 'liveactivity',
      payload: {
        aps: {
          timestamp: 100,
          event: 'end',
          'content-state': card([['session-1', 'One', 'done']], 0),
          'dismissal-date': 100 + LIVE_ACTIVITY_DISMISS_S,
        },
      },
    })
    expect(tokensOf('session-1')).toEqual([])
    expect(tokensOf('session-2')).toEqual(['la-other'])
  })

  test('one card lists all its conversations and ends only with the last', async () => {
    await store.addToken('session-2', token('la-1'), row('Two'))
    await recordLiveActivityPhase(deps, 'session-1', 'done', 10)

    expect(contentOf('la-1')).toEqual({
      timestamp: 100,
      event: 'update',
      'content-state': card(
        [
          ['session-1', 'One', 'done'],
          ['session-2', 'Two', 'running'],
        ],
        1,
      ),
    })
    expect(contentOf('la-2')).toMatchObject({ event: 'end' })
    expect(tokensOf('session-2')).toEqual(['la-other', 'la-1'])

    await recordLiveActivityPhase(deps, 'session-2', 'failed', 12)

    expect(contentOf('la-1')).toMatchObject({
      event: 'end',
      'content-state': card(
        [
          ['session-2', 'Two', 'failed'],
          ['session-1', 'One', 'done'],
        ],
        0,
      ),
    })
    expect(tokensOf('session-1')).toEqual([])
    expect(tokensOf('session-2')).toEqual([])
  })

  test('shows the three newest conversations and counts the rest', async () => {
    for (const id of ['a', 'b', 'c', 'd']) await store.addToken(id, token('la-1'), row(id))
    await recordLiveActivityPhase(deps, 'c', 'approval', 9)

    expect(contentOf('la-1')).toMatchObject({
      event: 'update',
      'content-state': card(
        [
          ['c', 'c', 'approval'],
          ['d', 'd', 'running'],
          ['b', 'b', 'running'],
        ],
        5,
        2,
      ),
    })
  })

  test('an approval updates the card and keeps its token', async () => {
    await recordLiveActivityPhase(deps, 'session-1', 'approval', 9)

    expect(sent[0]?.payload).toEqual({
      aps: {
        timestamp: 100,
        event: 'update',
        'content-state': card([['session-1', 'One', 'approval']], 1),
      },
    })
    expect(tokensOf('session-1')).toEqual(['la-1', 'la-2'])
  })

  test('a throttled or failed end keeps the token and is retried until it lands', async () => {
    responses = { 'la-1': { status: 429, reason: 'TooManyRequests' }, 'la-2': new Error('reset') }
    await recordLiveActivityPhase(deps, 'session-1', 'failed', 10)

    expect(tokensOf('session-1')).toEqual(['la-1', 'la-2'])
    expect(scheduled.map((s) => s.delayMs)).toEqual([LIVE_ACTIVITY_RETRY_MS[0]!])

    responses = { 'la-2': { status: 503 } }
    sent = []
    await runScheduled()
    expect(sent.map((r) => r.deviceToken)).toEqual(['la-1', 'la-2'])
    expect(contentOf('la-1')).toMatchObject({
      event: 'end',
      'content-state': card([['session-1', 'One', 'failed']], 0),
    })
    expect(tokensOf('session-1')).toEqual(['la-2'])

    responses = {}
    await runScheduled()
    expect(tokensOf('session-1')).toEqual([])
    expect(scheduled).toEqual([])
  })

  test('gives up after the last retry without dropping the token', async () => {
    responses = { 'la-1': { status: 500 }, 'la-2': { status: 500 } }
    await recordLiveActivityPhase(deps, 'session-1', 'done', 10)
    for (const _ of LIVE_ACTIVITY_RETRY_MS) await runScheduled()

    expect(scheduled).toEqual([])
    expect(tokensOf('session-1')).toEqual(['la-1', 'la-2'])
  })

  test('a retry never overwrites a newer phase', async () => {
    responses = { 'la-1': { status: 429 } }
    await recordLiveActivityPhase(deps, 'session-1', 'running', 8)
    responses = {}
    await recordLiveActivityPhase(deps, 'session-1', 'approval', 9)
    sent = []
    await runScheduled()

    expect(sent).toEqual([])
    expect(sessions.get('session-1')?.phase).toBe('approval')
  })

  test("an old end's retry does not end the card of a later run", async () => {
    responses = { 'la-1': { status: 503 } }
    await recordLiveActivityPhase(deps, 'session-1', 'done', 10)
    expect(tokensOf('session-1')).toEqual(['la-1'])

    responses = {}
    await recordLiveActivityPhase(deps, 'session-1', 'running', 12)
    sent = []
    await runScheduled()

    expect(sent).toEqual([])
  })

  test('a retry skips a token that was removed meanwhile', async () => {
    responses = { 'la-1': { status: 429 }, 'la-2': { status: 429 } }
    await recordLiveActivityPhase(deps, 'session-1', 'approval', 9)
    await store.removeToken('la-2')
    responses = {}
    sent = []
    await runScheduled()

    expect(sent.map((r) => r.deviceToken)).toEqual(['la-1'])
  })

  test('drops a token APNs says is dead from every conversation', async () => {
    await store.addToken('session-2', token('la-1'), row('Two'))
    responses = { 'la-1': { status: 410, reason: 'Unregistered' } }
    await recordLiveActivityPhase(deps, 'session-1', 'approval', 9)

    expect(tokensOf('session-1')).toEqual(['la-2'])
    expect(tokensOf('session-2')).toEqual(['la-other'])
    expect(scheduled).toEqual([])
  })

  test('is a no-op without APNs credentials', async () => {
    await recordLiveActivityPhase({ ...deps, credentials: () => null }, 'session-1', 'done', 10)

    expect(sent).toEqual([])
  })
})

describe('Live Activity registration', () => {
  test('a turn that ended before the token arrived ends the card on registration', async () => {
    await recordLiveActivityPhase(deps, 'session-3', 'stopped', 10)
    expect(sent).toEqual([])

    await registerLiveActivityToken(deps, 'session-3', token('late'), row('Three'))

    expect(sent.map((r) => r.deviceToken)).toEqual(['late'])
    expect(contentOf('late')).toMatchObject({
      event: 'end',
      'content-state': card([['session-3', 'Three', 'stopped']], 0),
    })
    expect(tokensOf('session-3')).toEqual([])
  })

  test('a token stored while the turn ends is reached by the end', async () => {
    const registering = registerLiveActivityToken(deps, 'session-3', token('racing'), row('Three'))
    const ending = recordLiveActivityPhase(deps, 'session-3', 'done', 10)

    await Promise.all([registering, ending])

    expect(sent.filter((r) => r.deviceToken === 'racing').length).toBeGreaterThanOrEqual(1)
    expect(sent.every((r) => (r.payload as { aps: { event: string } }).aps.event === 'end')).toBe(
      true,
    )
    expect(tokensOf('session-3')).toEqual([])
  })

  test('a new run returns its row to Running; a late start never undoes its own end', async () => {
    await recordLiveActivityPhase(deps, 'session-1', 'running', 8)
    expect(sent.map((r) => r.payload)).toEqual([
      {
        aps: {
          timestamp: 100,
          event: 'update',
          'content-state': card([['session-1', 'One', 'running']], 1),
        },
      },
      {
        aps: {
          timestamp: 100,
          event: 'update',
          'content-state': card([['session-1', 'One', 'running']], 1),
        },
      },
    ])

    sent = []
    await registerLiveActivityToken(deps, 'session-1', token('la-3'), row('One'))
    expect(sent).toEqual([])

    await recordLiveActivityPhase(deps, 'session-1', 'done', 10)
    await recordLiveActivityPhase(deps, 'session-1', 'running', 8)
    await registerLiveActivityToken(deps, 'session-1', token('la-4'), row('One'))

    expect(sent.at(-1)).toMatchObject({ deviceToken: 'la-4', payload: { aps: { event: 'end' } } })
  })

  test('a run starting on a conversation without activities stores nothing', async () => {
    await recordLiveActivityPhase(deps, 'session-9', 'running', 8)

    expect(sessions.has('session-9')).toBe(false)
  })
})

describe('liveActivityPhase', () => {
  test('maps turn outcomes; a silent pause leaves the activity running', () => {
    expect(liveActivityPhase({ kind: 'finished', text: '' }, false)).toBe('done')
    expect(liveActivityPhase({ kind: 'failed', cause: 'x' }, false)).toBe('failed')
    expect(liveActivityPhase({ kind: 'approval' }, false)).toBe('approval')
    expect(liveActivityPhase(null, true)).toBe('stopped')
    expect(liveActivityPhase(null, false)).toBeNull()
  })
})
