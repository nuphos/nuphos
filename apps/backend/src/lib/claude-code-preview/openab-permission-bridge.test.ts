import { describe, expect, test } from 'bun:test'

import {
  OPENAB_PERMISSION_DECISION_TIMEOUT_MS,
  PERMISSION_TIMED_OUT_TEXT,
  handleOpenAbPermissionRequest,
} from './openab-permission-bridge'

type BridgeDeps = NonNullable<Parameters<typeof handleOpenAbPermissionRequest>[1]>

const request = {
  sessionId: 'openab-session',
  toolCall: {
    toolCallId: 'tool-dangerous',
    title: 'Patch MongoDBCommunity',
    rawInput: { command: 'kubectl patch mongodbcommunity example' },
  },
  options: [
    { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
    { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
  ],
}

describe('OpenAB permission bridge', () => {
  test('a request with no options cancels without emitting frames', async () => {
    const frames: unknown[] = []
    const outcome = await handleOpenAbPermissionRequest(
      {
        userId: 'user-1',
        conversationId: 'conversation-1',
        request: { ...request, options: [] },
        emit: (frame) => frames.push(frame),
        handleTool: () => undefined,
      },
      {
        getSessionBypass: () => Promise.reject(new Error('unused')),
        registerWait: () => Promise.reject(new Error('unused')),
        awaitDecision: () => Promise.reject(new Error('unused')),
      },
    )

    expect(outcome).toEqual({ outcome: { outcome: 'cancelled' } })
    expect(frames).toEqual([])
  })

  test('a queued user message supersedes the tool wait instead of blocking the conversation', async () => {
    let awaited = false
    const superseded: unknown[] = []
    const frames: Record<string, unknown>[] = []

    const outcome = await handleOpenAbPermissionRequest(
      {
        userId: 'actor-1',
        conversationOwnerUserId: 'owner-1',
        conversationId: 'conversation-1',
        request,
        emit: (frame) => frames.push(frame),
        handleTool: () => undefined,
      },
      {
        getSessionBypass: async () => false,
        registerWait: async (args) => ({ ...args, waitId: 'permission-wait-1', createdAt: 1 }),
        awaitDecision: async () => {
          awaited = true

          return { timedOut: true as const }
        },
        hasPendingMessages: async (userId, sessionId) =>
          userId === 'owner-1' && sessionId === 'conversation-1',
        supersedePermissions: async (args) => {
          superseded.push(args)

          return 1
        },
      },
    )

    expect(awaited).toBe(false)
    expect(superseded).toEqual([{ userId: 'actor-1', sessionId: 'conversation-1' }])
    expect(frames.some((frame) => frame.type === 'tool-approval-request')).toBe(false)
    expect(outcome).toEqual({ outcome: { outcome: 'cancelled' } })
  })

  test('reveals the tool card so the approval request has a card to attach to', async () => {
    const tools: Record<string, unknown>[] = []

    await handleOpenAbPermissionRequest(
      {
        userId: 'user-1',
        conversationId: 'conversation-1',
        request,
        emit: () => {},
        handleTool: (update) => tools.push(update),
      },
      {
        getSessionBypass: async () => true,
        registerWait: () => Promise.reject(new Error('unused')),
        awaitDecision: () => Promise.reject(new Error('unused')),
      },
    )

    expect(tools[0]).toMatchObject({ toolCallId: 'tool-dangerous', revealed: true })
  })

  test('parks the active turn and returns the exact option selected by the user', async () => {
    const frames: Record<string, unknown>[] = []
    const tools: unknown[] = []
    const waits: unknown[] = []
    const awaited: unknown[] = []

    const outcome = await handleOpenAbPermissionRequest(
      {
        userId: 'user-1',
        conversationId: 'conversation-1',
        request,
        emit: (frame) => frames.push(frame),
        handleTool: (update) => tools.push(update),
      },
      {
        getSessionBypass: async () => false,
        registerWait: async (args) => {
          waits.push(args)

          return {
            ...args,
            waitId: 'permission-wait-1',
            createdAt: 1,
          }
        },
        awaitDecision: async (args) => {
          awaited.push(args)

          return {
            timedOut: false as const,
            decision: {
              payload: { decision: 'approved', selectedOptionId: 'allow-once' },
              resolvedAt: 2,
            },
          }
        },
      },
    )

    expect(waits).toEqual([
      {
        userId: 'user-1',
        sessionId: 'conversation-1',
        kind: 'agent-permission',
        ref: 'tool-dangerous',
      },
    ])
    expect(awaited).toEqual([
      {
        userId: 'user-1',
        sessionId: 'conversation-1',
        waitId: 'permission-wait-1',
        timeoutMs: OPENAB_PERMISSION_DECISION_TIMEOUT_MS,
      },
    ])
    expect(tools).toEqual([
      {
        kind: 'tool',
        toolCallId: 'tool-dangerous',
        title: 'Patch MongoDBCommunity',
        status: 'pending',
        rawInput: { command: 'kubectl patch mongodbcommunity example' },
        revealed: true,
      },
    ])
    expect(frames).toEqual([
      {
        type: 'authorization-decision',
        toolCallId: 'tool-dangerous',
        decision: 'require_auth',
        layer: 'openab_acp',
        reason: 'OpenAB requested permission before running this tool.',
      },
      {
        type: 'tool-approval-request',
        toolCallId: 'tool-dangerous',
        approvalId: 'openab:permission-wait-1',
        source: 'openab',
        options: request.options,
      },
    ])
    expect(outcome).toEqual({ outcome: { outcome: 'selected', optionId: 'allow-once' } })
  })

  test('bypass selects allow-once without opening a human decision wait', async () => {
    let registered = false
    const frames: Record<string, unknown>[] = []

    const outcome = await handleOpenAbPermissionRequest(
      {
        userId: 'user-1',
        conversationId: 'conversation-1',
        request,
        emit: (frame) => frames.push(frame),
        handleTool: () => undefined,
      },
      {
        getSessionBypass: async () => true,
        registerWait: async () => {
          registered = true
          throw new Error('must not register')
        },
        awaitDecision: async () => {
          throw new Error('must not wait')
        },
      },
    )

    expect(registered).toBe(false)
    expect(frames).toEqual([
      {
        type: 'authorization-decision',
        toolCallId: 'tool-dangerous',
        decision: 'allow',
        layer: 'bypass',
        reason: 'Full Access is enabled for this conversation.',
      },
    ])
    expect(outcome).toEqual({ outcome: { outcome: 'selected', optionId: 'allow-once' } })
  })

  test('bypass fails closed when the provider offers no allow option', async () => {
    const frames: Record<string, unknown>[] = []
    const outcome = await handleOpenAbPermissionRequest(
      {
        userId: 'user-1',
        conversationId: 'conversation-1',
        request: {
          ...request,
          options: [{ optionId: 'allow-always', name: 'Always allow', kind: 'allow_always' }],
        },
        emit: (frame) => frames.push(frame),
        handleTool: () => undefined,
      },
      {
        getSessionBypass: async () => true,
        registerWait: async () => {
          throw new Error('must not register')
        },
        awaitDecision: async () => {
          throw new Error('must not wait')
        },
      },
    )

    expect(frames).toContainEqual({
      type: 'authorization-decision',
      toolCallId: 'tool-dangerous',
      decision: 'deny',
      layer: 'bypass',
      reason: 'OpenAB did not offer an allow option.',
    })
    expect(outcome).toEqual({ outcome: { outcome: 'cancelled' } })
  })

  test('an ordinary approval conservatively selects the offered allow-once option', async () => {
    const outcome = await handleOpenAbPermissionRequest(
      {
        userId: 'user-1',
        conversationId: 'conversation-1',
        request,
        emit: () => undefined,
        handleTool: () => undefined,
      },
      {
        getSessionBypass: async () => false,
        registerWait: async (args) => ({ ...args, waitId: 'permission-wait-1', createdAt: 1 }),
        awaitDecision: async () => ({
          timedOut: false as const,
          decision: { payload: { decision: 'approved' }, resolvedAt: 2 },
        }),
      },
    )

    expect(outcome).toEqual({ outcome: { outcome: 'selected', optionId: 'allow-once' } })
  })

  test('an unknown, rejected, or timed-out decision fails closed', async () => {
    const base = {
      userId: 'user-1',
      conversationId: 'conversation-1',
      request,
      emit: () => undefined,
      handleTool: () => undefined,
    }
    const deps: Pick<BridgeDeps, 'getSessionBypass' | 'registerWait'> = {
      getSessionBypass: async () => false,
      registerWait: async (args) => ({ ...args, waitId: 'permission-wait-1', createdAt: 1 }),
    }
    const unknown = await handleOpenAbPermissionRequest(base, {
      ...deps,
      awaitDecision: async () => ({
        timedOut: false as const,
        decision: {
          payload: { decision: 'approved', selectedOptionId: 'not-offered' },
          resolvedAt: 2,
        },
      }),
    })
    const rejected = await handleOpenAbPermissionRequest(base, {
      ...deps,
      awaitDecision: async () => ({
        timedOut: false as const,
        decision: { payload: { decision: 'rejected' }, resolvedAt: 2 },
      }),
    })
    const timedOut = await handleOpenAbPermissionRequest(base, {
      ...deps,
      awaitDecision: async () => ({ timedOut: true as const }),
    })

    expect(unknown).toEqual({ outcome: { outcome: 'cancelled' } })
    expect(rejected).toEqual({ outcome: { outcome: 'cancelled' } })
    expect(timedOut).toEqual({ outcome: { outcome: 'cancelled' } })
  })

  test('every unanswered outcome tells the card why the tool did not run', async () => {
    const reasons: unknown[] = []
    const settle = (resolved: Awaited<ReturnType<BridgeDeps['awaitDecision']>>) =>
      handleOpenAbPermissionRequest(
        {
          userId: 'user-1',
          conversationId: 'conversation-1',
          request,
          emit: () => undefined,
          handleTool: (update) => {
            if (update.status === 'failed') reasons.push(update.contentText)
          },
        },
        {
          getSessionBypass: async () => false,
          registerWait: async (args) => ({ ...args, waitId: 'permission-wait-1', createdAt: 1 }),
          awaitDecision: async () => resolved,
        },
      )

    await settle({ timedOut: true, reason: 'timeout' })
    await settle({ timedOut: true, reason: 'aborted' })
    await settle({
      timedOut: false,
      decision: { payload: { decision: 'rejected' }, resolvedAt: 2 },
    })
    await settle({
      timedOut: false,
      decision: { payload: { decision: 'rejected', reason: 'turn_cancelled' }, resolvedAt: 2 },
    })

    expect(reasons).toEqual([
      PERMISSION_TIMED_OUT_TEXT,
      'Permission request was cancelled',
      'Permission denied',
      'Permission request was cancelled',
    ])
  })

  test('hands the decision to the turn before answering the agent', async () => {
    const order: string[] = []
    const outcome = await handleOpenAbPermissionRequest(
      {
        userId: 'user-1',
        conversationId: 'conversation-1',
        request,
        emit: () => undefined,
        handleTool: () => undefined,
        onDecision: (decision) => order.push(`adopt:${String(decision.streamId)}`),
      },
      {
        getSessionBypass: async () => false,
        registerWait: async (args) => ({ ...args, waitId: 'permission-wait-1', createdAt: 1 }),
        awaitDecision: async () => ({
          timedOut: false as const,
          decision: { payload: { decision: 'approved' }, streamId: 'st-2', resolvedAt: 2 },
        }),
      },
    )

    expect(order).toEqual(['adopt:st-2'])
    expect(outcome).toEqual({ outcome: { outcome: 'selected', optionId: 'allow-once' } })
  })

  test('an approval that arrives after the turn stopped is not honoured', async () => {
    const stop = new AbortController()
    const outcome = await handleOpenAbPermissionRequest(
      {
        userId: 'user-1',
        conversationId: 'conversation-1',
        request,
        emit: () => undefined,
        handleTool: () => undefined,
        signal: stop.signal,
      },
      {
        getSessionBypass: async () => false,
        registerWait: async (args) => ({ ...args, waitId: 'permission-wait-1', createdAt: 1 }),
        awaitDecision: async () => {
          stop.abort()

          return {
            timedOut: false as const,
            decision: { payload: { decision: 'approved' }, resolvedAt: 2 },
          }
        },
      },
    )

    expect(outcome).toEqual({ outcome: { outcome: 'cancelled' } })
  })
})
