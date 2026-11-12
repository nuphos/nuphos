import { beforeEach, describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'
import { useRedis } from '@/lib/test/doubles/redis'
import { useFakeRuntimeRequests } from '@/lib/test/doubles/runtime-request-store'

import type * as dbActual from '@/lib/db'

useRedis({ redisEnabled: () => false, withRedis: async () => null })

const conversationUpdates: Record<string, unknown>[][] = []
// How many documents the next updates match: an open request, or none.
let matchedCount = 1

useDb({
  db: (() => ({
    collection: () => ({
      updateOne: async (...args: Record<string, unknown>[]) => {
        conversationUpdates.push(args)

        return { matchedCount }
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
const { decisionToolModule: createDecisionToolModule } = await import('./decisions')

const decisionToolModule = (options: Parameters<typeof createDecisionToolModule>[0]) =>
  createDecisionToolModule({ runStreamId: async () => undefined, ...options })
const { unansweredInstruction } = await import('./decision-specs')
const { awaitDecisionOnce } = await import('./decision-wait')

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
            $slice: -100,
          },
        },
      },
    ])
    // The answer is the user's next message — nothing is parked on the waiter.
    expect(await listPendingPreviewWaits(ctx.userId, ctx.sessionId)).toEqual([])
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
        inputRequests: { $elemMatch: { id: 'nuphos-1', status: 'open' } },
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

  test('withdraw_user_decision dismisses the open request', async () => {
    const tools = decisionToolModule({ publish: async () => {} }).handlers(ctx)
    const result = await tools.withdraw_user_decision!({ label: 'Withdraw', requestId: 'nuphos-1' })

    expect(result.structuredContent).toMatchObject({ status: 'withdrawn' })
    expect(conversationUpdates.at(-1)).toEqual([
      {
        sessionId: 'conv-1',
        userId: 'u1',
        inputRequests: { $elemMatch: { id: 'nuphos-1', status: 'open' } },
      },
      {
        $set: {
          'inputRequests.$.status': 'dismissed',
          'inputRequests.$.resolvedAt': expect.any(Date),
        },
      },
    ])
  })

  test('several questions in one, or choices in the text, are rejected before any card goes out', async () => {
    const frames: Record<string, unknown>[] = []
    const tools = decisionToolModule({
      publish: async (_ctx, frame) => {
        frames.push(frame)
      },
    }).handlers(ctx)
    const several = await tools.request_user_decision!({
      label: 'Ask two things',
      category: 'preference',
      question:
        '1. Is this definition right? (Yes (Recommended) / Adjust) 2. How should the AI pick a component? (Guide (Recommended) / Descriptions only)',
    })
    const inline = await tools.request_user_decision!({
      label: 'Ask with inline choices',
      category: 'preference',
      question:
        'Which rule should components follow? (Repeated or stateful (Recommended) / Basics only)',
    })

    expect(several.isError).toBe(true)
    expect(JSON.stringify(several.content)).toContain('once per question')
    expect(inline.isError).toBe(true)
    expect(JSON.stringify(inline.content)).toContain('`options`')
    expect(frames).toEqual([])
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
})

useFakeRuntimeRequests()
