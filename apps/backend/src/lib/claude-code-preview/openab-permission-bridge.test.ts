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

  test.each([true, false])(
    'explains a new message cancelling approval (already queued=%s)',
    async (queued) => {
      const tools: Record<string, unknown>[] = []
      const outcome = await handleOpenAbPermissionRequest(
        {
          userId: 'actor-1',
          conversationId: 'conversation-1',
          request,
          emit: () => undefined,
          handleTool: (update) => tools.push(update),
        },
        {
          getSessionBypass: async () => false,
          registerWait: async (args) => ({ ...args, waitId: 'wait-1', createdAt: 1 }),
          hasPendingMessages: async () => queued,
          supersedePermissions: async () => 1,
          awaitDecision: async () => ({
            timedOut: false as const,
            decision: {
              payload: { decision: 'rejected', reason: 'superseded_by_user_message' },
              resolvedAt: 2,
            },
          }),
        },
      )

      expect(outcome).toEqual({ outcome: { outcome: 'cancelled' } })
      expect(tools.at(-1)).toMatchObject({
        status: 'failed',
        contentText:
          'Not run: a new message cancelled the pending approval. Ask again if you still want it.',
        revealed: true,
      })
    },
  )

  test.each([
    [false, true],
    [true, undefined],
  ])(
    'reveals the tool card only when an approval request needs it (Full Access=%s)',
    async (bypass, revealed) => {
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
          getSessionBypass: async () => bypass,
          registerWait: async (args) => ({ ...args, waitId: 'wait-1', createdAt: 1 }),
          awaitDecision: async () => ({ timedOut: true as const, reason: 'cancelled' as const }),
          hasPendingMessages: async () => false,
        },
      )

      expect(tools[0]).toMatchObject({ toolCallId: 'tool-dangerous' })
      expect(tools[0]?.revealed).toBe(revealed)
    },
  )

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
      reason: 'The agent did not offer an allow option.',
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

test.each([true, false])(
  'a teammate follows the conversation mode (Full Access=%s)',
  async (fullAccess) => {
    const frames: Record<string, unknown>[] = []
    const waits: string[] = []
    const outcome = await handleOpenAbPermissionRequest(
      {
        userId: 'teammate',
        conversationOwnerUserId: 'owner',
        conversationId: 'shared',
        request,
        emit: (frame) => frames.push(frame),
        handleTool: () => undefined,
      },
      {
        getSessionBypass: async (sessionId, userId) => {
          expect([sessionId, userId]).toEqual(['shared', 'owner'])

          return fullAccess
        },
        registerWait: async (args) => {
          waits.push(args.userId)

          return { ...args, waitId: 'wait', createdAt: 0 }
        },
        hasPendingMessages: async () => false,
        awaitDecision: async () => ({
          timedOut: false as const,
          decision: {
            userId: 'teammate',
            sessionId: 'shared',
            waitId: 'wait',
            resolvedAt: 1,
            payload: { decision: 'approved', optionId: 'allow-once' },
          },
        }),
      },
    )

    expect(waits).toEqual(fullAccess ? [] : ['teammate'])
    expect(frames.some((frame) => frame.type === 'tool-approval-request')).toBe(!fullAccess)
    expect(outcome).toEqual({ outcome: { outcome: 'selected', optionId: 'allow-once' } })
  },
)

describe('OpenAB permission bridge in an automatic turn nobody is watching', () => {
  const neverAsked: BridgeDeps = {
    getSessionBypass: async () => false,
    registerWait: () => Promise.reject(new Error('an automatic turn asks nobody')),
    awaitDecision: () => Promise.reject(new Error('an automatic turn waits for nobody')),
    inOwnerBotChat: async () => false,
  }
  const ask = (toolCall: { toolCallId: string; title: string; rawInput?: unknown }) => {
    const frames: Record<string, unknown>[] = []
    const tools: Record<string, unknown>[] = []
    const outcome = handleOpenAbPermissionRequest(
      {
        userId: 'owner-1',
        conversationId: 'conversation-1',
        request: { ...request, toolCall },
        emit: (frame) => frames.push(frame),
        handleTool: (update) => tools.push(update),
        run: { deadlineAt: 1, channelIds: ['woke-1'], trace: { route: 'agent.resource' } },
      },
      neverAsked,
    )

    return { outcome, frames, tools }
  }

  test.each([
    // Claude Code names an MCP tool mcp__<server>__<tool>; reading the channel that woke it.
    { title: 'mcp__nuphos-tools__channel_read', rawInput: { channelId: 'woke-1' } },
    // codex-acp names it mcp.<server>.<tool> and wraps its arguments; answering there.
    {
      title: 'mcp.nuphos-tools.channel_post',
      rawInput: {
        server: 'nuphos-tools',
        tool: 'channel_post',
        arguments: { channelId: 'woke-1', text: 'hi' },
      },
    },
  ])('runs $title without asking', async (call) => {
    const { outcome, frames } = ask({ toolCallId: 'read-1', ...call })

    expect(await outcome).toEqual({ outcome: { outcome: 'selected', optionId: 'allow-once' } })
    expect(frames.some((frame) => frame.type === 'tool-approval-request')).toBe(false)
  })

  test.each([
    { title: 'Patch MongoDBCommunity', rawInput: { command: 'kubectl patch x' } },
    { title: 'mcp__nuphos-tools__get_kubeconfig', rawInput: {} },
    { title: 'mcp__other-server__channel_read', rawInput: { channelId: 'woke-1' } },
    // Reading another channel, or the owner's memory, could be posted back to this one.
    { title: 'mcp__nuphos-tools__channel_read', rawInput: { channelId: 'other-2' } },
    { title: 'mcp__nuphos-tools__memory_get', rawInput: { query: 'q' } },
    // Posting anywhere but the channel that woke the turn still needs a person.
    { title: 'mcp__nuphos-tools__channel_post', rawInput: { channelId: 'other-2', text: 'hi' } },
  ])('fails $title at once, saying how to let it run', async (call) => {
    const { outcome, frames, tools } = ask({ toolCallId: 'act-1', ...call })

    // A reject keeps the turn going so the Bot can still reply; a cancel would end it silently.
    expect(await outcome).toEqual({ outcome: { outcome: 'selected', optionId: 'reject-once' } })
    expect(frames.some((frame) => frame.type === 'tool-approval-request')).toBe(false)
    const failed = tools.find((update) => update.status === 'failed')

    expect(String(failed?.contentText)).toContain('Full Access')
    expect(String(failed?.contentText)).not.toContain(PERMISSION_TIMED_OUT_TEXT)
  })

  test('falls back to a cancel when the agent offers no reject option', async () => {
    const outcome = await handleOpenAbPermissionRequest(
      {
        userId: 'owner-1',
        conversationId: 'conversation-1',
        request: {
          ...request,
          options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }],
        },
        emit: () => undefined,
        handleTool: () => undefined,
        run: { deadlineAt: 1, channelIds: ['woke-1'], trace: { route: 'agent.resource' } },
      },
      neverAsked,
    )

    expect(outcome).toEqual({ outcome: { outcome: 'cancelled' } })
  })

  test("a sub-Task's request still asks, for a person to answer from the sidebar", async () => {
    const waits: string[] = []
    const outcome = await handleOpenAbPermissionRequest(
      {
        userId: 'owner-1',
        conversationId: 'conversation-1',
        request,
        emit: () => undefined,
        handleTool: () => undefined,
        run: { deadlineAt: 1, trace: { route: 'agent.thread' } },
      },
      {
        getSessionBypass: async () => false,
        registerWait: async (wait) => {
          waits.push(wait.ref)

          return { ...wait, waitId: 'wait-1', createdAt: 1 }
        },
        awaitDecision: async () => ({
          timedOut: false as const,
          decision: { payload: { decision: 'approved' } } as never,
        }),
      },
    )

    expect(waits).toEqual(['tool-dangerous'])
    expect(outcome).toEqual({ outcome: { outcome: 'selected', optionId: 'allow-once' } })
  })

  test('an unanswered request in a headless turn is rejected, so the turn can still reply', async () => {
    const tools: Record<string, unknown>[] = []
    const outcome = await handleOpenAbPermissionRequest(
      {
        userId: 'owner-1',
        conversationId: 'conversation-1',
        request,
        emit: () => undefined,
        handleTool: (update) => tools.push(update),
        run: { deadlineAt: 1, trace: { route: 'agent.thread' } },
      },
      {
        getSessionBypass: async () => false,
        registerWait: async (wait) => ({ ...wait, waitId: 'wait-1', createdAt: 1 }),
        awaitDecision: async () => ({ timedOut: true as const, reason: 'timeout' }),
      },
    )

    expect(outcome).toEqual({ outcome: { outcome: 'selected', optionId: 'reject-once' } })
    expect(tools.find((update) => update.status === 'failed')?.contentText).toBe(
      PERMISSION_TIMED_OUT_TEXT,
    )
  })

  describe("in the owner's own chat with the Bot", () => {
    const woken = (userId: string, inChat = true) => {
      const frames: Record<string, unknown>[] = []
      const chats: unknown[] = []
      const outcome = handleOpenAbPermissionRequest(
        {
          userId,
          conversationOwnerUserId: 'owner-1',
          conversationId: 'bot-1',
          request,
          emit: (frame) => frames.push(frame),
          handleTool: () => undefined,
          run: { deadlineAt: 1, channelIds: ['chat-1'], trace: { route: 'agent.resource' } },
        },
        {
          getSessionBypass: async () => false,
          registerWait: async (wait) => ({ ...wait, waitId: 'wait-1', createdAt: 1 }),
          awaitDecision: async () => ({
            timedOut: false as const,
            decision: { payload: { decision: 'rejected' } } as never,
          }),
          hasPendingMessages: async () => false,
          inOwnerBotChat: async (args) => {
            chats.push(args)

            return inChat
          },
        },
      )

      return { outcome, frames, chats }
    }

    test('asks the owner, and a reject lets the turn reply', async () => {
      const { outcome, frames, chats } = woken('owner-1')

      expect(await outcome).toEqual({ outcome: { outcome: 'selected', optionId: 'reject-once' } })
      expect(frames.some((frame) => frame.type === 'tool-approval-request')).toBe(true)
      expect(chats).toEqual([
        {
          channelIds: ['chat-1'],
          agentSessionId: 'bot-1',
          ownerUserId: 'owner-1',
        },
      ])
    })

    test('a group chat or another channel still fails at once', async () => {
      const { outcome, frames } = woken('owner-1', false)

      expect(await outcome).toEqual({ outcome: { outcome: 'selected', optionId: 'reject-once' } })
      expect(frames.some((frame) => frame.type === 'tool-approval-request')).toBe(false)
    })

    test('a turn someone else runs is not asked, since only the owner can answer there', async () => {
      const { outcome, frames, chats } = woken('teammate')

      expect(await outcome).toEqual({ outcome: { outcome: 'selected', optionId: 'reject-once' } })
      expect(frames.some((frame) => frame.type === 'tool-approval-request')).toBe(false)
      expect(chats).toEqual([])
    })
  })
})
