import { beforeEach, describe, expect, test } from 'bun:test'

import {
  BADGE_DEBOUNCE_MS,
  createTurnNotifier,
  SESSION_COALESCE_MS,
  USER_PUSHES_PER_MINUTE,
} from './notify'

import type { ApnsCredentials, ApnsRequest, ApnsResponse } from './apns'
import type { PushDevice, PushDeviceStore } from './devices'
import type { NotifiableRun, TurnNotifierDeps } from './notify'

const credentials: ApnsCredentials = {
  keyId: 'K',
  teamId: 'T',
  bundleId: 'ai.nuphos.ios',
  privateKey: 'unused',
  environment: 'production',
}
const frame = (payload: Record<string, unknown>) => `data: ${JSON.stringify(payload)}\n\n`
const finishedFrames = [
  frame({ type: 'text-delta', id: 't', delta: 'All done.' }),
  frame({ type: 'atlas-turn-complete', finishReason: 'stop' }),
  frame({ type: 'atlas-stream-done' }),
]

function device(token: string, userId = 'user-1'): PushDevice {
  return {
    userId,
    token,
    deviceId: `device-${token}`,
    platform: 'ios',
    environment: 'sandbox',
    createdAt: new Date(0),
    updatedAt: new Date(0),
  }
}

function run(overrides: Partial<NotifiableRun> = {}): NotifiableRun {
  return {
    userId: 'owner-1',
    sessionId: 'session-1',
    createdAt: 1_000,
    frames: finishedFrames,
    abortController: { signal: { aborted: false } },
    trace: { userId: 'user-1', teamId: 'team-1', method: 'POST' },
    ...overrides,
  }
}

let devices: PushDevice[]
let removed: string[]
let sent: ApnsRequest[]
let responses: Record<string, ApnsResponse>
let now: number
let configured: boolean
let planNumber: number | null
let unread: number
let scheduled: { work: () => void; delayMs: number }[]

function notifier(overrides: Partial<TurnNotifierDeps> = {}) {
  const store: PushDeviceStore = {
    register: async () => undefined,
    unregister: async () => undefined,
    listForUser: async (userId) => devices.filter((d) => d.userId === userId),
    removeToken: async (token) => {
      removed.push(token)
    },
  }

  return createTurnNotifier({
    credentials: () => (configured ? credentials : null),
    devices: store,
    send: async (_credentials, request) => {
      sent.push(request)

      return responses[request.deviceToken] ?? { status: 200 }
    },
    conversation: async () => ({ title: 'Clear the cache', teamId: 'team-from-doc' }),
    proposedPlanNumber: async () => planNumber,
    unreadCount: async () => unread,
    schedule: (work, delayMs) => {
      scheduled.push({ work, delayMs })
    },
    now: () => now,
    ...overrides,
  })
}

beforeEach(() => {
  devices = [device('aa'), device('bb')]
  removed = []
  sent = []
  responses = {}
  now = 100_000
  configured = true
  planNumber = null
  unread = 3
  scheduled = []
})

describe('turn notifier', () => {
  test('sends the finished answer to every device of the user who ran the turn', async () => {
    await notifier().runEnded(run())

    expect(sent.map((r) => r.deviceToken)).toEqual(['aa', 'bb'])
    expect(sent[0]).toMatchObject({
      environment: 'sandbox',
      collapseId: 'session-1',
      payload: {
        aps: {
          alert: { title: 'Clear the cache', body: 'All done.' },
          badge: 3,
          sound: 'default',
          'thread-id': 'session-1',
        },
        sessionId: 'session-1',
        teamId: 'team-1',
      },
    })
  })

  test('is a no-op without APNs credentials', async () => {
    configured = false
    await notifier().runEnded(run())

    expect(sent).toEqual([])
  })

  test('skips trigger runs, silent pauses and user stops', async () => {
    const n = notifier()

    await n.runEnded(run({ trace: { userId: 'user-1', method: 'TRIGGER' } }))
    await n.runEnded(
      run({
        sessionId: 's-pause',
        frames: [frame({ type: 'atlas-turn-paused', reason: 'model-silence' })],
      }),
    )
    await n.runEnded(
      run({
        sessionId: 's-stop',
        abortController: { signal: { aborted: true } },
        frames: [frame({ type: 'atlas-turn-paused', reason: 'stream-ended-without-result' })],
      }),
    )

    expect(sent).toEqual([])
  })

  test('announces a plan proposed during the turn', async () => {
    planNumber = 7
    await notifier().runEnded(run())

    expect(sent[0]?.payload).toMatchObject({
      aps: { alert: { body: 'Plan #7 is waiting for approval' } },
    })
  })

  test('pushes a live approval once, not again when the turn parks on it', async () => {
    const n = notifier()
    const gated = run({
      awaitingAuthorization: true,
      frames: [
        frame({ type: 'tool-input-start', toolCallId: 'c1', toolName: 'kubectl delete pod' }),
        frame({ type: 'tool-approval-request', toolCallId: 'c1' }),
      ],
    })

    await n.approvalRequested(gated)
    now += SESSION_COALESCE_MS * 2
    gated.frames = [...gated.frames, frame({ type: 'atlas-turn-complete' })]
    await n.runEnded(gated)

    expect(sent).toHaveLength(2)
    expect(sent[0]?.payload).toMatchObject({
      aps: { alert: { body: 'Waiting for your approval: kubectl delete pod' } },
    })
  })

  test('coalesces a burst on one conversation and caps a user across conversations', async () => {
    const n = notifier()

    await n.runEnded(run())
    await n.runEnded(run())
    expect(sent).toHaveLength(2)

    for (let i = 0; i < USER_PUSHES_PER_MINUTE + 3; i += 1) {
      now += 1
      await n.runEnded(run({ sessionId: `other-${String(i)}` }))
    }
    expect(sent).toHaveLength(2 * USER_PUSHES_PER_MINUTE)
  })

  test('prunes tokens APNs says are dead and keeps the rest', async () => {
    responses = { aa: { status: 410, reason: 'Unregistered' }, bb: { status: 429 } }
    await notifier().runEnded(run())

    expect(removed).toEqual(['aa'])
  })

  test('falls back to the conversation team and first message', async () => {
    await notifier({
      conversation: async () => ({ title: '', firstMessage: 'why is prod slow', teamId: 'team-2' }),
    }).runEnded(run({ trace: { userId: 'user-1', method: 'POST' } }))

    expect(sent[0]?.payload).toMatchObject({
      aps: { alert: { title: 'why is prod slow' } },
      teamId: 'team-2',
    })
  })

  test('a send failure does not stop delivery to the other devices', async () => {
    await notifier({
      send: async (_c, request) => {
        if (request.deviceToken === 'aa') throw new Error('socket hang up')
        sent.push(request)

        return { status: 200 }
      },
    }).runEnded(run())

    expect(sent.map((r) => r.deviceToken)).toEqual(['bb'])
  })

  test('counts the badge only after the turn activity is recorded', async () => {
    let recorded = false

    await notifier({
      unreadCount: () => Promise.resolve(recorded ? 4 : 3),
    }).runEnded(
      run({
        activityRecorded: Promise.resolve().then(() => {
          recorded = true
        }),
      }),
    )

    expect(sent[0]?.payload).toMatchObject({ aps: { badge: 4 } })
  })

  test('a read sends one debounced badge-only update to every device', async () => {
    const n = notifier()

    n.badgeChanged('user-1')
    n.badgeChanged('user-1')
    expect(scheduled).toHaveLength(1)
    expect(scheduled[0]?.delayMs).toBe(BADGE_DEBOUNCE_MS)
    unread = 0
    scheduled[0]?.work()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(sent.map((r) => r.payload)).toEqual([{ aps: { badge: 0 } }, { aps: { badge: 0 } }])
    expect(sent[0]?.collapseId).toBe('badge')
    n.badgeChanged('user-1')
    expect(scheduled).toHaveLength(2)
  })

  test('a badge update is skipped without credentials or devices', async () => {
    configured = false
    notifier().badgeChanged('user-1')
    expect(scheduled).toEqual([])

    configured = true
    devices = []
    const n = notifier()

    n.badgeChanged('user-1')
    scheduled[0]?.work()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(sent).toEqual([])
  })

  test('forgets conversations and users once their windows pass', async () => {
    const n = notifier()

    for (let i = 0; i < 5; i += 1) {
      devices.push(device(`u${String(i)}`, `user-${String(i + 10)}`))
      await n.runEnded(
        run({
          sessionId: `s-${String(i)}`,
          trace: { userId: `user-${String(i + 10)}`, method: 'POST' },
        }),
      )
    }
    expect(n.trackedKeys()).toBe(10)

    now += 2 * 60_000
    await n.runEnded(run({ sessionId: 'later' }))

    expect(n.trackedKeys()).toBe(2)
  })
})
