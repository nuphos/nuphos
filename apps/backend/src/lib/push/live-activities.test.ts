import { beforeEach, describe, expect, test } from 'bun:test'

import {
  LIVE_ACTIVITY_DISMISS_S,
  liveActivityPhase,
  pushLiveActivityPhase,
} from './live-activities'

import type { ApnsRequest, ApnsResponse } from './apns'
import type { LiveActivity, LiveActivityDeps } from './live-activities'

let activities: LiveActivity[]
let sent: ApnsRequest[]
let responses: Record<string, ApnsResponse>

function activity(token: string, sessionId = 'session-1'): LiveActivity {
  return { token, userId: 'viewer', sessionId, environment: 'production', createdAt: new Date(0) }
}

const deps: LiveActivityDeps = {
  credentials: () => ({
    keyId: 'K',
    teamId: 'T',
    bundleId: 'ai.nuphos.ios',
    privateKey: 'unused',
    environment: 'production',
  }),
  liveActivities: {
    register: async () => {},
    listForSession: async (sessionId) => activities.filter((a) => a.sessionId === sessionId),
    removeToken: async (token) => {
      activities = activities.filter((a) => a.token !== token)
    },
  },
  send: async (_credentials, request) => {
    sent.push(request)

    return responses[request.deviceToken] ?? { status: 200 }
  },
  now: () => 100_000,
}

beforeEach(() => {
  activities = [activity('la-1'), activity('la-2'), activity('la-other', 'session-2')]
  sent = []
  responses = {}
})

describe('Live Activity pushes', () => {
  test('a finished turn ends every activity on the conversation', async () => {
    await pushLiveActivityPhase(deps, 'session-1', 'done')

    expect(sent.map((r) => r.deviceToken)).toEqual(['la-1', 'la-2'])
    expect(sent[0]).toEqual({
      deviceToken: 'la-1',
      environment: 'production',
      pushType: 'liveactivity',
      payload: {
        aps: {
          timestamp: 100,
          event: 'end',
          'content-state': { phase: 'done', endedAt: 100 },
          'dismissal-date': 100 + LIVE_ACTIVITY_DISMISS_S,
        },
      },
    })
    expect(activities.map((a) => a.token)).toEqual(['la-other'])
  })

  test('an approval updates the activity and keeps its token', async () => {
    await pushLiveActivityPhase(deps, 'session-1', 'approval')

    expect(sent[0]?.payload).toEqual({
      aps: { timestamp: 100, event: 'update', 'content-state': { phase: 'approval' } },
    })
    expect(activities).toHaveLength(3)
  })

  test('drops a dead token and keeps the rest', async () => {
    responses = { 'la-1': { status: 410, reason: 'Unregistered' }, 'la-2': { status: 429 } }
    await pushLiveActivityPhase(deps, 'session-1', 'approval')

    expect(activities.map((a) => a.token)).toEqual(['la-2', 'la-other'])
  })

  test('is a no-op without APNs credentials', async () => {
    await pushLiveActivityPhase({ ...deps, credentials: () => null }, 'session-1', 'done')

    expect(sent).toEqual([])
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
