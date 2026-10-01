import { beforeEach, describe, expect, test } from 'bun:test'

import { useRedis } from '@/lib/test/doubles/redis'
import { useFakeRuntimeRequests } from '@/lib/test/doubles/runtime-request-store'

useRedis({ redisEnabled: () => false, withRedis: async () => null })

const {
  listPendingPreviewWaits,
  registerPreviewWait,
  resetLocalPreviewWaits,
  resolvePreviewDecision,
} = await import('../decision-waiter')
const { decisionToolModule: createDecisionToolModule } = await import('./decisions')

const decisionToolModule = (options: Parameters<typeof createDecisionToolModule>[0]) =>
  createDecisionToolModule({ runStreamId: async () => undefined, ...options })
const { DECISION_SPECS, unansweredInstruction } = await import('./decision-specs')
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

beforeEach(() => resetLocalPreviewWaits())

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

  test('request_user_decision returns at once so the model can end the turn with its question', async () => {
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
    // The answer is the user's next message — nothing is parked on the waiter.
    expect(await listPendingPreviewWaits(ctx.userId, ctx.sessionId)).toEqual([])
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

  test('a decision the model can still read keeps its kind-specific instruction', () => {
    expect(DECISION_SPECS.propose_permission_grant).toBeUndefined()
  })
})

useFakeRuntimeRequests()
