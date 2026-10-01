import { beforeEach, describe, expect, test } from 'bun:test'

import { drainPendingUserMessages } from '@/lib/agent/pending-messages'
import { useAgentRunStore } from '@/lib/test/doubles/agent-run-store'

import {
  admitPreviewTurn,
  enqueuePreviewSteer,
  interceptPreviewSteering,
} from './chat-preview-steering'

import type { UIMessage } from 'ai'

let activeRuns: { streamId: string; actorUserId: string; startedAt: null }[] = []

const installRunStore = useAgentRunStore({
  getActiveAgentRunForSession: () => Promise.resolve(activeRuns[0] ?? null),
})

function userMessage(text: string): UIMessage {
  return { id: 'm1', role: 'user', parts: [{ type: 'text', text }] }
}

const ARGS = {
  runOwnerUserId: 'user-1',
  userId: 'user-1',
  teamId: 'team-1',
  sessionId: 'conv-steer',
}

beforeEach(async () => {
  activeRuns = [{ streamId: 'stream-live', actorUserId: ARGS.userId, startedAt: null }]
  installRunStore()
  await drainPendingUserMessages(ARGS.runOwnerUserId, ARGS.sessionId)
})

describe('interceptPreviewSteering', () => {
  test('parks the message and attaches to the live stream', async () => {
    const outcome = await interceptPreviewSteering({
      ...ARGS,
      messages: [userMessage('改用 staging cluster')],
    })

    expect(outcome).toEqual({ mode: 'attach', streamId: 'stream-live' })
    const queued = await drainPendingUserMessages(ARGS.runOwnerUserId, ARGS.sessionId)

    expect(queued.map((entry) => entry.renderedText)).toEqual(['改用 staging cluster'])
    expect(queued[0]?.source).toBe('app')
  })

  test('no active run means no steering', async () => {
    activeRuns = []

    expect(await interceptPreviewSteering({ ...ARGS, messages: [userMessage('hi')] })).toBeNull()
    expect(await drainPendingUserMessages(ARGS.runOwnerUserId, ARGS.sessionId)).toEqual([])
  })

  test('steers every runtime, not just Claude Code', async () => {
    // One admission policy: the standard runtime drains the same queue at its
    // own round boundary, so parking here beats launching a second concurrent
    // run that would interleave into the same transcript.
    expect(await interceptPreviewSteering({ ...ARGS, messages: [userMessage('hi')] })).toEqual({
      mode: 'attach',
      streamId: 'stream-live',
    })
    expect(
      (await drainPendingUserMessages(ARGS.runOwnerUserId, ARGS.sessionId)).map(
        (entry) => entry.renderedText,
      ),
    ).toEqual(['hi'])
  })

  test('a replacement run started during the handshake gets the fresh streamId', async () => {
    // Council F1: the first check's run ends and a DIFFERENT run replaces it
    // before the re-check — attaching must target the successor, never the
    // dead first stream.
    let reads = 0

    installRunStore({
      getActiveAgentRunForSession: () =>
        Promise.resolve(
          reads++ === 0
            ? { streamId: 'stream-old', startedAt: null, actorUserId: ARGS.userId }
            : { streamId: 'stream-new', startedAt: null, actorUserId: ARGS.userId },
        ),
    })
    const outcome = await interceptPreviewSteering({
      ...ARGS,
      messages: [userMessage('switch region')],
    })

    expect(outcome).toEqual({ mode: 'attach', streamId: 'stream-new' })
  })

  test('when the turn dies mid-handshake the message comes back as a launch', async () => {
    // First read sees the live run; the post-enqueue re-check sees it gone.
    let reads = 0

    installRunStore({
      getActiveAgentRunForSession: () =>
        Promise.resolve(
          reads++ === 0
            ? { streamId: 'stream-live', startedAt: null, actorUserId: ARGS.userId }
            : null,
        ),
    })
    const outcome = await interceptPreviewSteering({
      ...ARGS,
      messages: [userMessage('take two')],
    })

    expect(outcome).toEqual({ mode: 'launch' })
    // Ours was drained back to us; nothing is left parked to double-deliver.
    expect(await drainPendingUserMessages(ARGS.runOwnerUserId, ARGS.sessionId)).toEqual([])
  })

  test('refuses to steer a teammate instruction into another actor credential context', async () => {
    activeRuns = [{ streamId: 'stream-a', actorUserId: 'actor-a', startedAt: null }]

    await expect(
      interceptPreviewSteering({
        ...ARGS,
        userId: 'actor-b',
        messages: [userMessage('delete production')],
      }),
    ).rejects.toMatchObject({ code: 'conversation_in_use_by_teammate' })
    expect(await drainPendingUserMessages(ARGS.runOwnerUserId, ARGS.sessionId)).toEqual([])
  })
})

describe('enqueuePreviewSteer', () => {
  test('parks an explicit steer without replacing the live stream', async () => {
    const result = await enqueuePreviewSteer({
      runOwnerUserId: ARGS.runOwnerUserId,
      userId: ARGS.userId,
      sessionId: ARGS.sessionId,
      text: '先查 staging',
    })
    const queued = await drainPendingUserMessages(ARGS.runOwnerUserId, ARGS.sessionId)

    expect(queued).toHaveLength(1)
    expect(result.messageId).toBe(queued[0]!.id)
    expect(queued[0]?.renderedText).toBe('先查 staging')
  })

  test('leaves nothing queued when the turn is already over', async () => {
    activeRuns = []

    await expect(
      enqueuePreviewSteer({
        runOwnerUserId: ARGS.runOwnerUserId,
        userId: ARGS.userId,
        sessionId: ARGS.sessionId,
        text: 'too late',
      }),
    ).rejects.toMatchObject({ code: 'conversation_not_running' })
    expect(await drainPendingUserMessages(ARGS.runOwnerUserId, ARGS.sessionId)).toEqual([])
  })
})

describe('admitPreviewTurn', () => {
  test('claims an idle conversation on every runtime', async () => {
    activeRuns = []
    let claims = 0
    const outcome = await admitPreviewTurn(
      { ...ARGS, messages: [userMessage('next task')] },
      {
        claim: async () => {
          claims++

          return () => {}
        },
      },
    )

    expect(outcome?.mode).toBe('launch')
    expect(claims).toBe(1)
  })

  test('claims an idle Claude Code session before launching', async () => {
    activeRuns = []
    let released = false
    const outcome = await admitPreviewTurn(
      { ...ARGS, messages: [userMessage('next task')] },
      {
        claim: async () => () => {
          released = true
        },
      },
    )

    expect(outcome?.mode).toBe('launch')
    if (outcome?.mode === 'launch') outcome.releaseClaim()
    expect(released).toBe(true)
  })

  test('waits for the winning run to publish ownership instead of launching an overlap', async () => {
    let reads = 0
    let claimAttempts = 0

    installRunStore({
      getActiveAgentRunForSession: () =>
        Promise.resolve(
          reads++ === 0
            ? null
            : { streamId: 'stream-winner', startedAt: null, actorUserId: ARGS.userId },
        ),
    })
    const outcome = await admitPreviewTurn(
      { ...ARGS, messages: [userMessage('include the final pod list')] },
      {
        claim: async () => {
          claimAttempts++

          return null
        },
        attempts: 2,
        retryMs: 0,
      },
    )

    expect(outcome).toEqual({ mode: 'attach', streamId: 'stream-winner' })
    expect(claimAttempts).toBe(1)
    expect(await drainPendingUserMessages(ARGS.runOwnerUserId, ARGS.sessionId)).toHaveLength(1)
  })
})
