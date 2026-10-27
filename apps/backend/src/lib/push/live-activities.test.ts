import { beforeEach, describe, expect, test } from 'bun:test'

import {
  LIVE_ACTIVITY_DISMISS_S,
  LIVE_ACTIVITY_RETRY_MS,
  liveActivityPhase,
  recordLiveActivityState,
  registerLiveActivityToken,
} from './live-activities'

import type { ApnsRequest, ApnsResponse } from './apns'
import type { SessionExecutionState } from '@/lib/claude-code-preview/runtime-execution-snapshot'
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
const runtime = (
  state: SessionExecutionState['state'],
  extra: Partial<SessionExecutionState> = {},
) => ({ schemaVersion: 2, state, ...extra }) as SessionExecutionState
const RUNNING = runtime('active', { phase: 'running_tools' })
const APPROVAL = runtime('active', { phase: 'waiting_permission', permissionWaits: 1 })
const IDLE = runtime('idle', { phase: 'idle' })
const record = (sessionId: string, state: SessionExecutionState) =>
  recordLiveActivityState(deps, sessionId, state)
const contentOf = (deviceToken: string) =>
  (sent.findLast((r) => r.deviceToken === deviceToken)?.payload as { aps: Record<string, unknown> })
    .aps

// Mirrors the Mongo store: only a session with an activity changes, only when
// its phase does, and newer writes sort first.
const store: LiveActivityStore = {
  async setPhase(sessionId, phase) {
    const current = sessions.get(sessionId)

    if (!current || current.phase === phase) return null
    const next = { ...current, phase, updatedAt: new Date(++clock) }

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

describe('liveActivityPhase', () => {
  test('is the status the app shows for the runtime state', () => {
    expect(liveActivityPhase(RUNNING)).toBe('running')
    expect(liveActivityPhase(runtime('active', { phase: 'resume_pending' }))).toBe('running')
    expect(liveActivityPhase(runtime('idle', { phase: 'background_tools' }))).toBe('running')
    expect(liveActivityPhase(APPROVAL)).toBe('approval')
    expect(liveActivityPhase(runtime('active', { phase: 'resume_disconnected' }))).toBe('stopped')
    for (const phase of ['idle', 'failed', 'cancelled']) {
      expect(liveActivityPhase(runtime('idle', { phase }))).toBe('done')
    }
    expect(liveActivityPhase(runtime('dormant'))).toBe('done')
  })

  test('an unreachable or unreadable runtime is unavailable', () => {
    expect(liveActivityPhase(runtime('disconnected'))).toBe('unavailable')
    expect(liveActivityPhase(runtime('unsupported'))).toBe('unavailable')
    expect(liveActivityPhase({ state: 'idle' })).toBe('unavailable')
  })
})

describe('Live Activity pushes', () => {
  test('an idle runtime ends a card with nothing else running', async () => {
    await record('session-1', IDLE)

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

  test('a lost runtime connection shows Unavailable without ending the card', async () => {
    await record('session-1', RUNNING)
    sent = []
    await record('session-1', { state: 'disconnected' })

    expect(contentOf('la-1')).toEqual({
      timestamp: 100,
      event: 'update',
      'content-state': card([['session-1', 'One', 'unavailable']], 0),
    })
    expect(tokensOf('session-1')).toEqual(['la-1', 'la-2'])

    await record('session-1', RUNNING)
    expect(contentOf('la-1')).toMatchObject({
      event: 'update',
      'content-state': card([['session-1', 'One', 'running']], 1),
    })
  })

  test('only a phase change is pushed', async () => {
    await record('session-1', RUNNING)
    await record('session-1', runtime('active', { phase: 'thinking' }))

    expect(sent.map((r) => r.deviceToken)).toEqual(['la-1', 'la-2'])
  })

  test('one card lists all its conversations and ends only with the last', async () => {
    await store.addToken('session-2', token('la-1'), row('Two'))
    await record('session-1', IDLE)

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

    await record('session-2', runtime('active', { phase: 'resume_disconnected' }))

    expect(contentOf('la-1')).toMatchObject({
      event: 'end',
      'content-state': card(
        [
          ['session-2', 'Two', 'stopped'],
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
    await record('c', APPROVAL)

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
    await record('session-1', APPROVAL)

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
    await record('session-1', IDLE)

    expect(tokensOf('session-1')).toEqual(['la-1', 'la-2'])
    expect(scheduled.map((s) => s.delayMs)).toEqual([LIVE_ACTIVITY_RETRY_MS[0]!])

    responses = { 'la-2': { status: 503 } }
    sent = []
    await runScheduled()
    expect(sent.map((r) => r.deviceToken)).toEqual(['la-1', 'la-2'])
    expect(contentOf('la-1')).toMatchObject({
      event: 'end',
      'content-state': card([['session-1', 'One', 'done']], 0),
    })
    expect(tokensOf('session-1')).toEqual(['la-2'])

    responses = {}
    await runScheduled()
    expect(tokensOf('session-1')).toEqual([])
    expect(scheduled).toEqual([])
  })

  test('gives up after the last retry without dropping the token', async () => {
    responses = { 'la-1': { status: 500 }, 'la-2': { status: 500 } }
    await record('session-1', IDLE)
    for (const _ of LIVE_ACTIVITY_RETRY_MS) await runScheduled()

    expect(scheduled).toEqual([])
    expect(tokensOf('session-1')).toEqual(['la-1', 'la-2'])
  })

  test('a retry never overwrites a newer phase', async () => {
    responses = { 'la-1': { status: 503 } }
    await record('session-1', IDLE)
    expect(tokensOf('session-1')).toEqual(['la-1'])

    responses = {}
    await record('session-1', RUNNING)
    sent = []
    await runScheduled()

    expect(sent).toEqual([])
    expect(sessions.get('session-1')?.phase).toBe('running')
  })

  test('a retry skips a token that was removed meanwhile', async () => {
    responses = { 'la-1': { status: 429 }, 'la-2': { status: 429 } }
    await record('session-1', APPROVAL)
    await store.removeToken('la-2')
    responses = {}
    sent = []
    await runScheduled()

    expect(sent.map((r) => r.deviceToken)).toEqual(['la-1'])
  })

  test('drops a token APNs says is dead from every conversation', async () => {
    await store.addToken('session-2', token('la-1'), row('Two'))
    responses = { 'la-1': { status: 410, reason: 'Unregistered' } }
    await record('session-1', APPROVAL)

    expect(tokensOf('session-1')).toEqual(['la-2'])
    expect(tokensOf('session-2')).toEqual(['la-other'])
    expect(scheduled).toEqual([])
  })

  test('is a no-op without APNs credentials', async () => {
    await recordLiveActivityState({ ...deps, credentials: () => null }, 'session-1', IDLE)

    expect(sent).toEqual([])
  })

  test('a conversation without activities stores nothing', async () => {
    await record('session-9', IDLE)

    expect(sessions.has('session-9')).toBe(false)
    expect(sent).toEqual([])
  })
})

describe('Live Activity registration', () => {
  test('a runtime that went idle before the token arrived ends the card on registration', async () => {
    await registerLiveActivityToken(deps, 'session-3', token('late'), row('Three'), IDLE)

    expect(sent.map((r) => r.deviceToken)).toEqual(['late'])
    expect(contentOf('late')).toMatchObject({
      event: 'end',
      'content-state': card([['session-3', 'Three', 'done']], 0),
    })
    expect(tokensOf('session-3')).toEqual([])
  })

  test('a running runtime keeps the card running; an unknown one pushes nothing', async () => {
    await registerLiveActivityToken(deps, 'session-3', token('new'), row('Three'), RUNNING)
    expect(contentOf('new')).toMatchObject({
      event: 'update',
      'content-state': card([['session-3', 'Three', 'running']], 1),
    })

    sent = []
    await registerLiveActivityToken(deps, 'session-4', token('new'), row('Four'), null)
    expect(sent).toEqual([])
    expect(tokensOf('session-3')).toEqual(['new'])
  })

  test('a second phone joins a conversation already waiting for approval', async () => {
    await record('session-1', APPROVAL)
    sent = []
    await registerLiveActivityToken(deps, 'session-1', token('la-3'), row('One'), APPROVAL)

    expect(sent.map((r) => r.deviceToken)).toEqual(['la-3'])
    expect(contentOf('la-3')).toMatchObject({ event: 'update' })
  })
})
