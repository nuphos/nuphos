import { beforeEach, describe, expect, test } from 'bun:test'

import {
  ASK_OPEN_MS,
  NOTIFY_REPEAT_MS,
  nudge,
  openSignInRequest,
  releaseWhenAskLapses,
  signInRecipients,
} from './sign-in-request'
import { settleSignInRequests } from './sign-in-settle'

import type { NudgeConversation, NudgeDeps, NudgeKind, SignInRequest } from './sign-in-request'
import type { DownloadHandoffRateLimitResult } from '@/lib/download-handoff-rate-limit'
import type { NuphosTeamRole } from '@/lib/identity/types'

const TEAM = 'team-1'
const RUNTIME = 'managed-1'
const LOCAL = 'local_bryan_mac-1'
const members = [
  { id: 'bryan', name: 'Bryan', role: 'ADMINISTRATOR' as const, joinedAt: '2026-01-01' },
  { id: 'casey', name: 'Casey', role: 'ADMINISTRATOR' as const, joinedAt: '2026-03-01' },
  { id: 'shant', name: 'Shant', role: 'EDITOR' as const, joinedAt: '2026-02-01' },
  { id: 'dana', name: 'Dana', role: 'EDITOR' as const, joinedAt: '2026-02-02' },
  {
    id: 'gone',
    name: 'Gone',
    role: 'ADMINISTRATOR' as const,
    joinedAt: '2025-01-01',
    removedAt: '2026-01-02',
  },
]

let conversation: NudgeConversation
let quota: DownloadHandoffRateLimitResult
let signedIn: boolean | undefined
let now: number
let stored: { kind: NudgeKind; record: SignInRequest; since?: Date }[]
let notified: { userIds: string[]; title: string; body: string; sessionId: string }[]

function deps(): NudgeDeps {
  return {
    conversation: async () => conversation,
    members: async () => members,
    signedIn: async () => signedIn,
    quota: async () => quota,
    store: async (target, kind, record, since) => {
      stored.push({ kind, record, since })
      const existing = target[kind]
      // The conditional write: refused when this ask was notified after `since`.
      const repeat =
        since &&
        existing?.requesterId === record.requesterId &&
        existing.notifiedAt &&
        existing.notifiedAt > since

      if (repeat) return false
      target[kind] = since ? record : { ...existing, ...record }

      return true
    },
    notify: (userIds, push) => notified.push({ userIds, ...push }),
    now: () => now,
  }
}

const ask = (
  requesterId = 'shant',
  role: NuphosTeamRole = 'EDITOR',
  kind: NudgeKind = 'signInRequest',
  runtimeId = conversation.runtimeId ?? RUNTIME,
) => nudge(kind, { teamId: TEAM, runtimeId, sessionId: 's1', requesterId }, role, deps())

beforeEach(() => {
  conversation = {
    sessionId: 's1',
    userId: 'shant',
    teamId: TEAM,
    runtimeId: RUNTIME,
    runtimeLabel: 'Team Claude',
    title: 'Deploy',
    firstMessage: 'Deploy',
    messageCount: 1,
    createdAt: new Date(0),
    lastActiveAt: new Date(0),
  }
  quota = 'allowed'
  signedIn = false
  now = 1_000_000_000
  stored = []
  notified = []
})

describe('who is asked', () => {
  test("a team agent's administrators, longest-standing first; never editors or the removed", () => {
    expect(
      signInRecipients(RUNTIME, { id: 'shant', role: 'EDITOR' }, members)?.map((m) => m.id),
    ).toEqual(['bryan', 'casey'])
  })

  test("a computer's agent asks its owner only, even when the requester is an administrator", () => {
    expect(
      signInRecipients(LOCAL, { id: 'casey', role: 'ADMINISTRATOR' }, members)?.map((m) => m.id),
    ).toEqual(['bryan'])
  })

  test('someone who can sign it in themselves asks nobody', async () => {
    expect(signInRecipients(RUNTIME, { id: 'bryan', role: 'ADMINISTRATOR' }, members)).toBeNull()
    expect(signInRecipients(LOCAL, { id: 'bryan', role: 'EDITOR' }, members)).toBeNull()
    conversation.userId = 'bryan'
    await expect(ask('bryan', 'ADMINISTRATOR')).rejects.toMatchObject({
      status: 409,
      code: 'can_sign_in',
    })
    expect(stored).toHaveLength(0)
  })

  test('the push names the requester and the agent, and goes to the administrators', async () => {
    expect(await ask()).toEqual({ askedName: 'Bryan', notified: true })
    expect(notified).toEqual([
      {
        userIds: ['bryan', 'casey'],
        sessionId: 's1',
        teamId: TEAM,
        title: 'Sign-in requested',
        body: 'Shant asked you to sign in Team Claude so their message can run.',
      },
    ] as never)
    expect(conversation.signInRequest).toMatchObject({
      runtimeId: RUNTIME,
      requesterId: 'shant',
      askedUserIds: ['bryan', 'casey'],
      askedName: 'Bryan',
    })
  })
})

describe('who may ask', () => {
  test('someone who cannot reply in the conversation cannot ask from it', async () => {
    conversation.generalAccess = 'view'
    await expect(ask('dana')).rejects.toMatchObject({ status: 404 })
    conversation.generalAccess = 'none'
    await expect(ask('dana')).rejects.toMatchObject({ status: 404 })
    expect(notified).toHaveLength(0)
  })

  test('a conversation in another team, or on another agent, is refused', async () => {
    conversation.teamId = 'team-2'
    await expect(ask()).rejects.toMatchObject({ status: 404 })
    conversation.teamId = TEAM
    await expect(ask('shant', 'EDITOR', 'signInRequest', 'managed-2')).rejects.toMatchObject({
      status: 409,
      code: 'runtime_mismatch',
    })
  })
})

describe('repeats and the rate limit', () => {
  test('clicking again inside the window stores the ask but notifies nobody', async () => {
    await ask()
    now += NOTIFY_REPEAT_MS - 1
    expect(await ask()).toEqual({ askedName: 'Bryan', notified: false })
    expect(notified).toHaveLength(1)
    // The first notification still counts for the window.
    expect(conversation.signInRequest?.notifiedAt).toEqual(new Date(now - NOTIFY_REPEAT_MS + 1))
    now += 2
    expect((await ask()).notified).toBe(true)
    expect(notified).toHaveLength(2)
  })

  test('two clicks racing: only the one whose write lands notifies', async () => {
    await ask()
    // A stale read on another replica sees no notification yet.
    const stale = { ...conversation, signInRequest: undefined }
    const raced = await nudge(
      'signInRequest',
      { teamId: TEAM, runtimeId: RUNTIME, sessionId: 's1', requesterId: 'shant' },
      'EDITOR',
      {
        ...deps(),
        conversation: async () => stale,
        store: async (_target, kind, record, since) =>
          deps().store(conversation, kind, record, since),
      },
    )

    expect(raced.notified).toBe(false)
    expect(notified).toHaveLength(1)
  })

  test('over the limit is refused and stores nothing', async () => {
    quota = 'limited'
    await expect(ask()).rejects.toMatchObject({ status: 429, code: 'too_many_requests' })
    expect(stored).toHaveLength(0)
    expect(notified).toHaveLength(0)
  })

  test('a repeat does not spend the quota', async () => {
    await ask()
    quota = 'limited'
    expect((await ask()).notified).toBe(false)
  })

  test('without the shared quota the ask is stored for the Inbox, and nobody is pushed', async () => {
    quota = 'unavailable'
    expect((await ask()).notified).toBe(false)
    expect(conversation.signInRequest?.askedUserIds).toEqual(['bryan', 'casey'])
    expect(notified).toHaveLength(0)
  })
})

describe('settling', () => {
  test('an ask holds messages only while the queue would keep them', () => {
    const askedAt = new Date(now)

    conversation.signInRequest = {
      ...conversation.signInRequest!,
      runtimeId: RUNTIME,
      askedAt,
    }
    expect(openSignInRequest(conversation, now + ASK_OPEN_MS - 1)).not.toBeNull()
    expect(openSignInRequest(conversation, now + ASK_OPEN_MS)).toBeNull()
  })

  test('a sign-in releases every conversation that asked for it, once', async () => {
    const released: string[] = []
    const cleared = new Set<string>()
    const settled = await settleSignInRequests(TEAM, RUNTIME, {
      asking: async () => [
        { userId: 'shant', sessionId: 's1' },
        { userId: 'dana', sessionId: 's2' },
        { userId: 'dana', sessionId: 's2' },
      ],
      clear: async (sessionId) => !cleared.has(sessionId) && Boolean(cleared.add(sessionId)),
      released: (userId, sessionId) => released.push(`${userId}:${sessionId}`),
    })

    expect(settled).toBe(2)
    expect(released).toEqual(['shant:s1', 'dana:s2'])
  })

  test('a failure while settling never fails the sign-in', async () => {
    const settled = await settleSignInRequests(TEAM, RUNTIME, {
      asking: async () => {
        throw new Error('mongo down')
      },
      clear: async () => true,
      released: () => {},
    })

    expect(settled).toBe(0)
  })
})

describe('review: what an ask can hold', () => {
  test('an ask about another agent holds nothing once the conversation moves', async () => {
    await ask()
    expect(openSignInRequest(conversation, now)).not.toBeNull()
    conversation.runtimeId = 'managed-2'
    expect(openSignInRequest(conversation, now)).toBeNull()
  })

  test('asking again, by anyone, never extends the hold', async () => {
    await ask()
    const first = conversation.signInRequest!.askedAt

    now += NOTIFY_REPEAT_MS - 1
    await ask()
    now += NOTIFY_REPEAT_MS
    await ask('dana')
    expect(conversation.signInRequest!.askedAt).toEqual(first)
    expect(openSignInRequest(conversation, new Date(first).getTime() + ASK_OPEN_MS)).toBeNull()
  })

  test('an agent that reports itself signed in cannot be asked about', async () => {
    signedIn = true
    await expect(ask()).rejects.toMatchObject({ code: 'already_signed_in' })
    expect(stored).toHaveLength(0)
    expect(notified).toHaveLength(0)
    // Unknown is not "signed in": the ask goes ahead.
    signedIn = undefined
    expect((await ask()).notified).toBe(true)
  })

  test('a lapsed ask releases what it held, once per conversation', () => {
    const scheduled: number[] = []
    const fire: (() => void)[] = []
    let released = 0
    const record = { runtimeId: RUNTIME, askedAt: new Date(now) } as SignInRequest
    const schedule = (work: () => void, delayMs: number) => {
      scheduled.push(delayMs)
      fire.push(work)

      return 0 as unknown as ReturnType<typeof setTimeout>
    }

    releaseWhenAskLapses('u:s-lapse', record, () => released++, now + 1000, schedule)
    releaseWhenAskLapses('u:s-lapse', record, () => released++, now + 2000, schedule)
    expect(scheduled).toEqual([ASK_OPEN_MS])
    fire[0]?.()
    expect(released).toBe(1)
    // After it fired, a later hold schedules again.
    releaseWhenAskLapses('u:s-lapse', record, () => released++, now, schedule)
    expect(scheduled).toHaveLength(2)
  })
})
