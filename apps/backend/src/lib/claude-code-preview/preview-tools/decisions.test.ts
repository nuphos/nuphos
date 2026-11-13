import { beforeEach, describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useRedis } from '@/lib/test/doubles/redis'
import { useFakeRuntimeRequests } from '@/lib/test/doubles/runtime-request-store'

import type * as dbActual from '@/lib/db'

useRedis({ redisEnabled: () => false, withRedis: async () => null })

const conversationUpdates: Record<string, unknown>[][] = []
// How many documents the next updates match: an open request, or none.
let matchedCount = 1
// The conversation findOne reads back.
let storedConversation: Record<string, unknown> | null = null
// Other conversations by sessionId, read back instead of storedConversation.
let otherConversations: Record<string, Record<string, unknown>> = {}
// The conversations find returns, and the query it was asked.
let foundConversations: Record<string, unknown>[] = []
let findQuery: Record<string, unknown> | undefined

useDb({
  db: (() => ({
    collection: () => ({
      updateOne: async (...args: Record<string, unknown>[]) => {
        conversationUpdates.push(args)

        return { matchedCount }
      },
      findOne: async (filter?: { sessionId?: string }) =>
        (filter?.sessionId && otherConversations[filter.sessionId]) || storedConversation,
      find: (query: Record<string, unknown>) => {
        findQuery = query

        return { toArray: async () => foundConversations }
      },
    }),
  })) as unknown as typeof dbActual.db,
})

const {
  listPendingPreviewWaits,
  registerPreviewWait,
  resetLocalPreviewWaits,
  resolvePreviewDecision,
} = await import('../decision-waiter')

useIdentity({ getTeamMembership: async () => ({ role: 'member' }) as never })

const { decisionToolModule: createDecisionToolModule } = await import('./decisions')

const decisionToolModule = (options: Parameters<typeof createDecisionToolModule>[0]) =>
  createDecisionToolModule({ runStreamId: async () => undefined, ...options })
const { unansweredInstruction } = await import('./decision-specs')
const { awaitDecisionOnce } = await import('./decision-wait')
const { relatedQuestionsNote } = await import('@/lib/agent/db/pending-decision')

const ctx = { userId: 'u1', teamId: 't1', sessionId: 'conv-1', locale: 'zh-TW', localTools: true }

async function pendingWait() {
  for (let attempt = 0; attempt < 50; attempt++) {
    const [wait] = await listPendingPreviewWaits(ctx.userId, ctx.sessionId)

    if (wait) return wait
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('no wait registered')
}

beforeEach(() => {
  resetLocalPreviewWaits()
  matchedCount = 1
  storedConversation = null
  foundConversations = []
  findQuery = undefined
})

describe('decision tool module', () => {
  test('advertises the classic decision and client-side tools under their own names', () => {
    const names = decisionToolModule({ publish: async () => {} }).definitions.map(
      (definition) => (definition as { name: string }).name,
    )

    expect(names).toEqual(
      expect.arrayContaining([
        'request_user_decision',
        'port_forward_start',
        'port_forward_stop',
        'port_forward_list',
        'upload_attachment',
      ]),
    )
    // local_exec is a real backend-executed tool now (see preview-tools/local-exec.ts),
    // not one of this module's client-tool decision waits.
    expect(names).not.toContain('local_exec')
    expect(names).not.toContain('propose_permission_grant')
    // Nothing polls: a wait lives and dies inside the call that opened it.
    expect(names).not.toContain('check_decision')
  })

  test('request_user_decision returns at once; the answer arrives as a new message', async () => {
    const frames: Record<string, unknown>[] = []
    const tools = decisionToolModule({
      publish: async (_ctx, frame) => {
        frames.push(frame)
      },
    }).handlers(ctx)
    const result = await tools.request_user_decision!({
      label: 'Ask which region',
      category: 'preference',
      question: '要部署到哪個 region？',
      options: ['us-east', 'ap-south'],
    })

    expect(result.structuredContent).toMatchObject({
      status: 'awaiting_user_decision',
      question: '要部署到哪個 region？',
    })
    expect(frames.map((frame) => frame.type)).toEqual([
      'tool-input-available',
      'tool-output-available',
    ])
    expect(frames[0]).toMatchObject({ toolName: 'request_user_decision' })
    // Kept on the conversation for the Inbox, under the card's own call id.
    expect(conversationUpdates.at(-1)).toEqual([
      { sessionId: 'conv-1', userId: 'u1' },
      {
        $push: {
          inputRequests: {
            $each: [
              {
                id: frames[0]!.toolCallId,
                category: 'preference',
                question: '要部署到哪個 region？',
                options: ['us-east', 'ap-south'],
                askedAt: expect.any(Date),
                status: 'open',
              },
            ],
          },
        },
      },
    ])
    // The answer is the user's next message — nothing is parked on the waiter.
    expect(await listPendingPreviewWaits(ctx.userId, ctx.sessionId)).toEqual([])
  })

  test('a question records the channel whose post woke the turn, and only that one', async () => {
    const tools = decisionToolModule({ publish: () => Promise.resolve() }).handlers(ctx)
    const ask = (category: string) =>
      tools.request_user_decision!({ label: 'Ask', category, question: 'Ship it?' })

    // The turn's wake notice: a post in chan-2, though the Bot is in other channels too.
    storedConversation = {
      metadata: {
        version: 1,
        sender: { type: 'system', id: 'channel:chan-2', displayName: '#release' },
        source: 'agent.resource',
        sentAt: '2026-11-12T00:00:00Z',
      },
    }
    await ask('approval')
    expect(conversationUpdates.at(-1)?.[1]).toMatchObject({
      $push: { inputRequests: { $each: [{ channelId: 'chan-2' }] } },
    })
    // A person's own message started the turn: no channel is guessed.
    storedConversation = {
      metadata: {
        version: 1,
        sender: { type: 'user', id: 'u1', displayName: 'Yuanlin' },
        source: 'nuphos',
        sentAt: '2026-11-12T00:00:00Z',
      },
    }
    await ask('approval')
    expect(JSON.stringify(conversationUpdates.at(-1))).not.toContain('channelId')
  })

  test("a question no channel woke is asked in the Bot's one chat with its owner", async () => {
    const tools = decisionToolModule({ publish: () => Promise.resolve() }).handlers(ctx)
    const ask = () =>
      tools.request_user_decision!({ label: 'Ask', category: 'approval', question: 'Ship it?' })

    // A sub-agent's report woke the turn.
    storedConversation = {
      metadata: {
        version: 1,
        sender: { type: 'agent', id: 'thread-1', displayName: 'Worker' },
        source: 'agent.thread',
        sentAt: '2026-11-12T00:00:00Z',
      },
    }
    // The owner's chat with the Bot, and a team channel the Bot is also in.
    foundConversations = [
      { sessionId: 'chat-1', userId: 'u1' },
      { sessionId: 'team-chan', userId: 'u1', participantIds: ['u1', 'u2'] },
    ]
    await ask()
    expect(findQuery).toEqual({
      userId: 'u1',
      kind: 'channel',
      agentSessionIds: ['conv-1'],
      archivedAt: { $exists: false },
    })
    expect(conversationUpdates.at(-1)?.[1]).toMatchObject({
      $push: { inputRequests: { $each: [{ channelId: 'chat-1' }] } },
    })
    // Two open chats: which one the owner reads is not known, so none is recorded.
    foundConversations = [
      { sessionId: 'chat-1', userId: 'u1' },
      { sessionId: 'chat-2', userId: 'u1', participantIds: ['u1'] },
    ]
    await ask()
    expect(JSON.stringify(conversationUpdates.at(-1))).not.toContain('channelId')
    // No chat: a Task, answered where it was asked.
    foundConversations = []
    await ask()
    expect(JSON.stringify(conversationUpdates.at(-1))).not.toContain('channelId')
  })

  test("request_user_decision keeps a credential request's secretName for its secure card", async () => {
    await decisionToolModule({ publish: () => Promise.resolve() }).handlers(ctx)
      .request_user_decision!({
      label: 'Ask for the fixture key',
      category: 'credential',
      question: 'Paste the fixture key.',
      secretName: 'FIXTURE_KEY',
    })

    expect(conversationUpdates.at(-1)?.[1]).toMatchObject({
      $push: { inputRequests: { $each: [{ category: 'credential', secretName: 'FIXTURE_KEY' }] } },
    })
  })

  test("request_user_decision keeps an integration request's providers for its Connect card", async () => {
    await decisionToolModule({ publish: () => Promise.resolve() }).handlers(ctx)
      .request_user_decision!({
      label: 'Ask to connect Linear',
      category: 'integration',
      question: 'Connect Linear for this task.',
      providers: ['linear'],
    })

    expect(conversationUpdates.at(-1)?.[1]).toMatchObject({
      $push: { inputRequests: { $each: [{ category: 'integration', providers: ['linear'] }] } },
    })
  })

  test("request_user_decision keeps a request for the member's own credential exactly", async () => {
    await decisionToolModule({ publish: () => Promise.resolve() }).handlers(ctx)
      .request_user_decision!({
      label: 'Ask for your own GitHub',
      category: 'integration',
      question: 'Select your own GitHub for this task.',
      credentials: [{ provider: 'personal', id: 'github' }],
    })

    expect(conversationUpdates.at(-1)?.[1]).toMatchObject({
      $push: {
        inputRequests: {
          $each: [
            { category: 'integration', credentials: [{ provider: 'personal', id: 'github' }] },
          ],
        },
      },
    })
  })

  test('only the own GitHub or Linear can be named as a credential', async () => {
    await expect(
      decisionToolModule({ publish: () => Promise.resolve() }).handlers(ctx).request_user_decision!(
        {
          label: 'Ask for a team installation',
          category: 'integration',
          question: 'Select the installation.',
          credentials: [{ provider: 'github', id: '166381069' }],
        },
      ),
    ).resolves.toMatchObject({ isError: true })
  })

  test('a question names any access or the own credential, never both', async () => {
    await expect(
      decisionToolModule({ publish: () => Promise.resolve() }).handlers(ctx).request_user_decision!(
        {
          label: 'Ask for GitHub',
          category: 'integration',
          question: 'Select GitHub.',
          providers: ['github'],
          credentials: [{ provider: 'personal', id: 'github' }],
        },
      ),
    ).resolves.toMatchObject({ isError: true })
  })

  test('request_user_decision keeps its body for the Inbox and returns the requestId', async () => {
    const result = await decisionToolModule({ publish: async () => {} }).handlers(ctx)
      .request_user_decision!({
      label: 'Ask about the database',
      category: 'approval',
      question: 'Delete the staging database?',
      body: 'It has had no connections for **30 days**.',
      options: ['Delete', 'Keep'],
    })
    const { requestId } = result.structuredContent as { requestId: string }
    const [, update] = conversationUpdates.at(-1)!

    expect(requestId).toStartWith('nuphos-')
    expect(update).toMatchObject({
      $push: {
        inputRequests: {
          $each: [{ id: requestId, body: 'It has had no connections for **30 days**.' }],
        },
      },
    })
  })

  test('update_user_decision changes only the fields passed, on an open request', async () => {
    const tools = decisionToolModule({ publish: async () => {} }).handlers(ctx)
    const result = await tools.update_user_decision!({
      label: 'Add the backup option',
      requestId: 'nuphos-1',
      options: ['Delete', 'Keep', 'Back up, then delete'],
    })

    expect(result.isError).toBeFalsy()
    expect(conversationUpdates.at(-1)).toEqual([
      {
        sessionId: 'conv-1',
        userId: 'u1',
        'inputRequests.id': 'nuphos-1',
      },
      { $set: { 'inputRequests.$.options': ['Delete', 'Keep', 'Back up, then delete'] } },
    ])
  })

  test('update_user_decision rejects bad input and an answered request', async () => {
    const tools = decisionToolModule({ publish: async () => {} }).handlers(ctx)
    const before = conversationUpdates.length

    expect((await tools.update_user_decision!({ label: 'x', requestId: 'nuphos-1' })).isError).toBe(
      true,
    )
    expect(
      (await tools.update_user_decision!({ label: 'x', requestId: 'nuphos-1', options: ['one'] }))
        .isError,
    ).toBe(true)
    expect(conversationUpdates).toHaveLength(before)
    matchedCount = 0
    expect(
      (await tools.update_user_decision!({ label: 'x', requestId: 'nuphos-1', question: 'Now?' }))
        .isError,
    ).toBe(true)
  })

  test('update_user_decision replaces the questions and rewrites them after the body', async () => {
    storedConversation = {
      inputRequests: [
        {
          id: 'nuphos-1',
          question: 'Rollout?',
          body: 'CI passed.\n\n---\n\nRisks.\n\n---\n\n**1. Old?**\n\n**2. Older?**',
          questions: [{ question: 'Old?' }, { question: 'Older?' }],
          status: 'open',
        },
      ],
    }
    const tools = decisionToolModule({ publish: async () => {} }).handlers(ctx)
    const result = await tools.update_user_decision!({
      label: 'Ask about regions too',
      requestId: 'nuphos-1',
      questions: [
        { question: 'Which regions?', options: ['us', 'eu'], multiSelect: true },
        { question: 'Keep the old\n\n---\n\ncluster?' },
      ],
    })

    expect(result.isError).toBeFalsy()
    expect(conversationUpdates.at(-1)?.[1]).toMatchObject({
      $set: {
        'inputRequests.$.questions': [
          { question: 'Which regions?', options: ['us', 'eu'], multiSelect: true },
          { question: 'Keep the old\n\n---\n\ncluster?' },
        ],
        // Written on single lines, so the last separator is always the one added.
        'inputRequests.$.body':
          'CI passed.\n\n---\n\nRisks.\n\n---\n\n**1. Which regions?** (any number)\n- us\n- eu\n\n**2. Keep the old --- cluster?**',
      },
    })
  })

  test('withdraw_user_decision takes the open request off the list', async () => {
    const tools = decisionToolModule({ publish: async () => {} }).handlers(ctx)
    const result = await tools.withdraw_user_decision!({ label: 'Withdraw', requestId: 'nuphos-1' })

    expect(result.structuredContent).toMatchObject({ status: 'withdrawn' })
    expect(conversationUpdates.at(-1)).toEqual([
      {
        sessionId: 'conv-1',
        userId: 'u1',
        'inputRequests.id': 'nuphos-1',
      },
      { $pull: { inputRequests: { id: 'nuphos-1' } } },
    ])
  })

  test('several related questions and a multi-select go out as one card, kept for the Inbox', async () => {
    const tools = decisionToolModule({ publish: async () => {} }).handlers(ctx)
    const questions = [
      {
        question: 'Which regions?',
        options: ['us-east', 'eu-west', 'ap-south'],
        multiSelect: true,
      },
      { question: 'Keep the old cluster?', options: ['Keep', 'Delete'] },
    ]
    const result = await tools.request_user_decision!({
      label: 'Ask about the rollout',
      category: 'preference',
      question: 'How should the rollout go?',
      questions,
    })

    expect(result.isError).toBeFalsy()
    expect(conversationUpdates.at(-1)?.[1]).toMatchObject({
      $push: { inputRequests: { $each: [{ question: 'How should the rollout go?', questions }] } },
    })
    // Written out in the body for clients that draw only question and body.
    expect(conversationUpdates.at(-1)?.[1]).toMatchObject({
      $push: {
        inputRequests: {
          $each: [
            {
              body: '\n\n---\n\n**1. Which regions?** (any number)\n- us-east\n- eu-west\n- ap-south\n\n**2. Keep the old cluster?**\n- Keep\n- Delete',
            },
          ],
        },
      },
    })
  })

  test('one question with its choices in options still goes out', async () => {
    const tools = decisionToolModule({ publish: async () => {} }).handlers(ctx)
    const result = await tools.request_user_decision!({
      label: 'Ask about versions',
      category: 'preference',
      question: 'Upgrade from 1.2 to 1.3 now?',
      options: ['Upgrade (Recommended)', 'Later'],
    })

    expect(result.isError).toBeFalsy()
  })

  test('request_user_decision refuses a parameter it does not take, naming it', async () => {
    const frames: Record<string, unknown>[] = []
    const result = await decisionToolModule({
      publish: async (_ctx, frame) => {
        frames.push(frame)
      },
    }).handlers(ctx).request_user_decision!({
      label: 'Ask',
      category: 'preference',
      question: 'Which region?',
      choices: ['us-east-1', 'eu-west-1'],
    })

    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain("Unrecognized key(s) in object: 'choices'")
    expect(frames).toEqual([])
  })

  test('an integration decision carries its providers to the Desktop Connect card', async () => {
    const frames: Record<string, unknown>[] = []
    const tools = decisionToolModule({
      publish: async (_ctx, frame) => {
        frames.push(frame)
      },
    }).handlers(ctx)
    const result = await tools.request_user_decision!({
      label: 'Ask to connect Linear',
      category: 'integration',
      question: 'Filing the ticket needs a Linear workspace.',
      providers: ['linear'],
    })

    expect(result.structuredContent).toMatchObject({
      status: 'awaiting_user_decision',
      providers: ['linear'],
    })
    expect(frames[0]).toMatchObject({ input: { providers: ['linear'] } })
    expect(await listPendingPreviewWaits(ctx.userId, ctx.sessionId)).toEqual([])
  })

  test('without a Desktop session the integration question goes out without a card', async () => {
    const frames: Record<string, unknown>[] = []
    const tools = decisionToolModule({
      publish: async (_ctx, frame) => {
        frames.push(frame)
      },
    }).handlers({ ...ctx, localTools: false })
    const result = await tools.request_user_decision!({
      label: 'Ask to connect Linear',
      category: 'integration',
      question: 'Filing the ticket needs a Linear workspace.',
      providers: ['linear'],
    })

    expect(result.structuredContent).not.toHaveProperty('providers')
    expect((result.structuredContent as { instruction: string }).instruction).not.toContain('card')
    expect(frames[0]).not.toMatchObject({ input: { providers: ['linear'] } })
    // The question still records them, so selecting Linear in the picker answers it.
    expect(conversationUpdates.at(-1)?.[1]).toMatchObject({
      $push: { inputRequests: { $each: [{ providers: ['linear'] }] } },
    })
  })

  test('a credential decision with a secretName asks for the Desktop secure input card', async () => {
    const frames: Record<string, unknown>[] = []
    const tools = decisionToolModule({
      publish: async (_ctx, frame) => {
        frames.push(frame)
      },
    }).handlers(ctx)
    const result = await tools.request_user_decision!({
      label: 'Ask for the OpenAI key',
      category: 'credential',
      question: 'Calling the API needs your OpenAI key.',
      secretName: 'OPENAI_API_KEY',
    })
    const output = result.structuredContent as { secretName?: string; instruction: string }

    expect(output.secretName).toBe('OPENAI_API_KEY')
    expect(output.instruction).toContain('secure input card')
    expect(frames[0]).toMatchObject({ input: { secretName: 'OPENAI_API_KEY' } })
  })

  test('without a Desktop session the secret question goes out without a card', async () => {
    const tools = decisionToolModule({ publish: async () => {} }).handlers({
      ...ctx,
      localTools: false,
    })
    const result = await tools.request_user_decision!({
      label: 'Ask for the OpenAI key',
      category: 'credential',
      question: 'Calling the API needs your OpenAI key.',
      secretName: 'OPENAI_API_KEY',
    })

    expect(result.structuredContent).not.toHaveProperty('secretName')
    expect((result.structuredContent as { instruction: string }).instruction).not.toContain('card')
    // A sub-agent's turn has no Desktop session, yet its owner answers it from the
    // Inbox or a Bot's chat, which draw the secure card from the record.
    expect(conversationUpdates.at(-1)?.[1]).toMatchObject({
      $push: {
        inputRequests: { $each: [{ category: 'credential', secretName: 'OPENAI_API_KEY' }] },
      },
    })
  })

  test('client-side tools publish only the input card and return what the desktop ran', async () => {
    const frames: Record<string, unknown>[] = []
    const tools = decisionToolModule({
      publish: async (_ctx, frame) => {
        frames.push(frame)
      },
    }).handlers(ctx)
    const pending = tools.port_forward_stop!({ id: 'pf-1' })
    const wait = await pendingWait()

    expect(wait.kind).toBe('client-tool')
    // A ref keyed on the tool name would collide across every session running it.
    expect(wait.ref).toBeUndefined()
    expect(frames).toEqual([
      {
        type: 'tool-input-available',
        toolCallId: wait.waitId,
        toolName: 'port_forward_stop',
        input: { id: 'pf-1' },
      },
    ])

    await resolvePreviewDecision({
      userId: ctx.userId,
      sessionId: ctx.sessionId,
      waitId: wait.waitId,
      payload: { resumeReason: 'client-tool', output: { ok: true } },
    })
    expect((await pending).structuredContent).toMatchObject({
      tool: 'port_forward_stop',
      output: { ok: true },
    })
  })

  test('a client tool is refused outright where no device can run it', async () => {
    const frames: Record<string, unknown>[] = []
    const tools = decisionToolModule({
      publish: async (_ctx, frame) => {
        frames.push(frame)
      },
    }).handlers({ ...ctx, localTools: false })
    const result = await tools.port_forward_stop!({ id: 'pf-1' })

    expect(result.structuredContent).toMatchObject({
      tool: 'port_forward_stop',
      status: 'unavailable',
      reason: 'no_desktop_session',
    })
    // No card, no wait: there is nothing for the user to act on either way.
    expect(frames).toEqual([])
    expect(await listPendingPreviewWaits(ctx.userId, ctx.sessionId)).toEqual([])
  })

  test('a pending client tool is durable runtime state carrying its full call and owner stream', async () => {
    const tools = decisionToolModule({
      publish: async () => {
        throw new Error('stream already closed')
      },
      runStreamId: async () => 'stream-owner',
      timeoutMs: 10_000,
    }).handlers(ctx)

    void tools.port_forward_stop!({ id: 'pf-1' })
    const wait = await pendingWait()

    // Even with the stream frame lost, the runtime's request list alone is
    // enough for the owning desktop to run the call.
    expect(wait.clientTool).toEqual({
      toolName: 'port_forward_stop',
      input: { id: 'pf-1' },
      streamId: 'stream-owner',
    })
  })

  test('an oversized client tool input stays off the durable request', async () => {
    const tools = decisionToolModule({
      publish: async () => {},
      runStreamId: async () => undefined,
      timeoutMs: 10_000,
    }).handlers(ctx)

    void tools.port_forward_stop!({ id: 'x'.repeat(40_000) })
    const wait = await pendingWait()

    expect(wait.clientTool).toEqual({ toolName: 'port_forward_stop' })
  })

  test('a client tool nobody runs ends the wait and says the desktop did not run it', async () => {
    const frames: Record<string, unknown>[] = []
    const tools = decisionToolModule({
      publish: async (_ctx, frame) => {
        frames.push(frame)
      },
      timeoutMs: 30,
    }).handlers(ctx)
    const body = (await tools.port_forward_list!({})).structuredContent as {
      status: string
      instruction: string
      waited_seconds: number
    }

    expect(body.status).toBe('unanswered')
    expect(body.instruction).toBe(unansweredInstruction('client-tool'))
    expect(body.instruction).not.toContain('has not decided')
    expect(body.waited_seconds).toBeGreaterThanOrEqual(0)
    // The transcript card carries the same verdict as the tool result.
    expect(frames.at(-1)).toMatchObject({ type: 'tool-output-error' })
    // Nothing is left pending for a later turn to trip over.
    expect(await listPendingPreviewWaits(ctx.userId, ctx.sessionId)).toEqual([])
  })

  test('an undecided human card ends the wait without ever implying approval', async () => {
    await registerPreviewWait({
      userId: ctx.userId,
      sessionId: ctx.sessionId,
      waitId: 'nuphos-grant-1',
      kind: 'permission-grant',
      ref: 'proposal-1',
    })
    const outcome = await awaitDecisionOnce({
      userId: ctx.userId,
      sessionId: ctx.sessionId,
      waitId: 'nuphos-grant-1',
      kind: 'permission-grant',
      timeoutMs: 30,
    })

    expect(outcome.status).toBe('unanswered')
    const instruction = unansweredInstruction('permission-grant')

    expect(instruction).toContain('no longer be applied')
    expect(instruction).toContain('End your turn')
    // The card stays live in the app; only the turn stops holding itself open.
    expect(await listPendingPreviewWaits(ctx.userId, ctx.sessionId)).toEqual([])
  })

  test('list_user_decisions returns only the open questions, oldest first', async () => {
    const at = (iso: string) => new Date(iso)

    storedConversation = {
      inputRequests: [
        {
          id: 'r2',
          category: 'approval',
          question: 'Ship?',
          askedAt: at('2026-01-02'),
          status: 'open',
        },
        {
          id: 'r0',
          category: 'preference',
          question: 'Old',
          askedAt: at('2026-01-01'),
          status: 'answered',
        },
        {
          id: 'r1',
          category: 'preference',
          question: 'Region?',
          options: ['a', 'b'],
          askedAt: at('2026-01-01'),
          status: 'open',
        },
      ],
    }
    const tools = decisionToolModule({ publish: async () => {} }).handlers(ctx)
    const result = await tools.list_user_decisions!({ label: 'List my questions' })

    expect(result.structuredContent).toEqual({
      requests: [
        {
          requestId: 'r1',
          category: 'preference',
          question: 'Region?',
          options: ['a', 'b'],
          askedAt: at('2026-01-01'),
        },
        { requestId: 'r2', category: 'approval', question: 'Ship?', askedAt: at('2026-01-02') },
      ],
    })
  })

  test('a question names what it is about: a linked resource, never an unknown ref', async () => {
    storedConversation = { sessionId: 'conv-1', linkedResources: [{ id: 'res-1' }] }
    const tools = decisionToolModule({ publish: async () => {} }).handlers(ctx)
    const ask = (about: string[]) =>
      tools.request_user_decision!({
        label: 'Ask to merge',
        category: 'approval',
        question: 'Merge the PR?',
        options: ['Merge', 'Wait'],
        about,
      })

    expect((await ask(['res-1'])).isError).toBeFalsy()
    expect(conversationUpdates.at(-1)?.[1]).toMatchObject({
      $push: { inputRequests: { $each: [{ question: 'Merge the PR?', about: ['res-1'] }] } },
    })
    const before = conversationUpdates.length
    const unknown = await ask(['res-2'])

    expect(unknown.isError).toBe(true)
    expect(JSON.stringify(unknown.content)).toContain('list_session_resources')
    expect(conversationUpdates).toHaveLength(before)
  })

  test("a question may be about another conversation of the same owner, never another member's or a channel", async () => {
    storedConversation = { sessionId: 'conv-1', userId: 'u1', teamId: 't1' }
    otherConversations = {
      reviewer: { sessionId: 'reviewer', userId: 'u1', teamId: 't1' },
      stranger: { sessionId: 'stranger', userId: 'u2', teamId: 't1' },
      room: { sessionId: 'room', userId: 'u1', teamId: 't1', kind: 'channel' },
    }
    const tools = decisionToolModule({ publish: async () => {} }).handlers(ctx)
    const ask = (about: string[]) =>
      tools.request_user_decision!({
        label: 'Ask to approve',
        category: 'approval',
        question: 'Approve the PR?',
        about,
      })

    try {
      expect((await ask(['reviewer'])).isError).toBeFalsy()
      expect(conversationUpdates.at(-1)?.[1]).toMatchObject({
        $push: { inputRequests: { $each: [{ about: ['reviewer'] }] } },
      })
      for (const ref of ['stranger', 'room']) {
        const refused = await ask([ref])

        expect(refused.isError).toBe(true)
        expect(JSON.stringify(refused.content)).toContain('another conversation you own')
      }
    } finally {
      otherConversations = {}
    }
  })

  test('a wake from a resource lists the open questions about it, and nothing when there are none', () => {
    const conversation = {
      inputRequests: [
        {
          id: 'q1',
          category: 'approval',
          question: 'Merge?',
          about: ['res-1'],
          askedAt: new Date(),
          status: 'open',
        },
        {
          id: 'q2',
          category: 'approval',
          question: 'Old',
          about: ['res-1'],
          askedAt: new Date(),
          status: 'answered',
        },
        {
          id: 'q3',
          category: 'preference',
          question: 'Other',
          askedAt: new Date(),
          status: 'open',
        },
      ],
    } as Parameters<typeof relatedQuestionsNote>[0]
    const note = relatedQuestionsNote(conversation, 'res-1', 'resource')

    expect(note).toContain('- q1: "Merge?"')
    expect(note).not.toContain('q2')
    expect(note).not.toContain('q3')
    expect(note).toContain('withdraw_user_decision')
    expect(relatedQuestionsNote(conversation, 'res-9', 'resource')).toBe('')
  })
})

useFakeRuntimeRequests()
