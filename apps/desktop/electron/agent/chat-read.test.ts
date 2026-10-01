import assert from 'node:assert/strict'
import { test } from 'node:test'

import { resolveStreamOutcome } from './chat-outcome.ts'
import { consumeChatStream } from './chat-read.ts'
import { createChatStreamState } from './chat-shared.ts'

import type { ChatStreamCtx } from './chat-shared.ts'

function sse(...frames: Record<string, unknown>[]): Response {
  return new Response(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  })
}

test('completes a delivered turn when only its trailing resume becomes unavailable', async () => {
  const emitted: unknown[] = []
  const state = createChatStreamState(0)
  const ctx: ChatStreamCtx = {
    streamId: 'stream-1',
    sessionId: 'session-1',
    explicitResume: false,
    signal: new AbortController().signal,
    state,
    emit: (event) => emitted.push(event),
    noteFirstFrame: () => {},
  }
  const read = await consumeChatStream(
    ctx,
    sse(
      { type: 'tool-input-available', toolCallId: 'tool-1' },
      { type: 'atlas-turn-complete' },
      {
        type: 'error',
        errorCode: 'stream_unresumable',
        errorText: 'Agent run stream is no longer available',
        details: { reason: 'stream_never_registered' },
      },
      { type: 'atlas-stream-done' },
    ),
    true,
  )

  assert.equal(read.kind, 'read')
  if (read.kind !== 'read') throw new Error('expected a readable SSE response')

  const outcome = await resolveStreamOutcome(ctx, read, true, Date.now(), true)

  assert.equal(outcome, 'completed')
  assert.equal(state.completedSuccessfully, true)
  assert.equal(state.freshRetryAttempts, 0)
  assert.equal(
    emitted.some((event) => (event as { type?: string }).type === 'error'),
    false,
  )
})

test('revoked credentials stop fresh and resumed streams immediately, preserving partial output', async () => {
  for (const explicitResume of [false, true]) {
    const emitted: unknown[] = []
    const state = createChatStreamState(0)
    let cancelled = false
    const frames = [
      { type: 'text-delta', delta: 'Partial answer' },
      ...(explicitResume ? [{ type: 'tool-input-available', toolCallId: 'tool-1' }] : []),
      {
        type: 'error',
        errorText:
          '**Internal Error** (code: -32603) Internal error > Your access token could not be refreshed because your refresh token was revoked. Please log out and sign in again.',
        requestId: '71a54b14d07ada256d006d923b84a577',
      },
      { type: 'atlas-turn-complete' },
      { type: 'atlas-stream-done' },
    ]
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(''),
          ),
        )
        // Deliberately keep the body open: reauthentication must not wait
        // for EOF or the idle watchdog, or process trailing success frames.
      },
      cancel() {
        cancelled = true
      },
    })
    const result = await consumeChatStream(
      {
        streamId: 'stream-1',
        sessionId: 'session-1',
        explicitResume,
        signal: new AbortController().signal,
        state,
        emit: (event) => emitted.push(event),
        noteFirstFrame: () => {},
      },
      new Response(body),
      explicitResume,
    )

    assert.deepEqual(result, { kind: 'stop' })
    assert.equal(cancelled, true)
    assert.equal(state.freshRetryAttempts, 0)
    assert.equal(state.reconnectAttempts, 0)
    assert.equal(state.terminalEventDetected, false)
    assert.equal(state.completedSuccessfully, false)
    assert.equal(emitted.length, explicitResume ? 3 : 2)
    assert.deepEqual(emitted[0], { type: 'sse', data: frames[0] })
    assert.equal((emitted.at(-1) as { reason: string }).reason, 'reauthentication')
  }
})

test('ordinary internal errors remain eligible for the existing fresh-retry policy', async () => {
  const result = await consumeChatStream(
    {
      streamId: 'stream-1',
      sessionId: 'session-1',
      explicitResume: false,
      signal: new AbortController().signal,
      state: createChatStreamState(0),
      emit: () => assert.fail('transient errors should be handled by the retry policy'),
      noteFirstFrame: () => {},
    },
    sse({ type: 'error', errorText: '**Internal Error** (code: -32603) Internal error' }),
    false,
  )

  assert.equal(result.kind, 'read')
  if (result.kind === 'read') assert.equal(result.needsFreshRetry, true)
})

const interruption = {
  type: 'turn-interrupted',
  id: 'failed-attempt',
  reason: 'error',
  message: 'The agent failed before it could answer.',
}

function retryContext() {
  const emitted: { type?: string; data?: { type?: string } }[] = []
  const ctx: ChatStreamCtx = {
    streamId: 'retry',
    sessionId: 'session',
    explicitResume: false,
    signal: new AbortController().signal,
    state: createChatStreamState(0),
    emit: (event) => emitted.push(event as (typeof emitted)[number]),
    noteFirstFrame: () => {},
  }

  return { ctx, emitted }
}

test('a recoverable failed attempt never emits Turn failed into its successful retry', async () => {
  const { ctx, emitted } = retryContext()
  const read = await consumeChatStream(
    ctx,
    sse(
      interruption,
      { type: 'error', errorText: 'Session is not attached to this connection' },
      { type: 'atlas-stream-done' },
    ),
    false,
  )

  assert.equal(read.kind, 'read')
  if (read.kind !== 'read') throw new Error('expected read')
  assert.equal(await resolveStreamOutcome(ctx, read, false, Date.now(), true), 'retry')
  const success = await consumeChatStream(
    ctx,
    sse(
      { type: 'tool-input-available', toolCallId: 'merge' },
      { type: 'atlas-turn-complete' },
      { type: 'atlas-stream-done' },
    ),
    false,
  )

  if (success.kind !== 'read') throw new Error('expected read')
  assert.equal(await resolveStreamOutcome(ctx, success, false, Date.now(), true), 'completed')
  assert.equal(
    emitted.some((e) => e.type === 'reset-partial'),
    true,
  )
  assert.equal(
    emitted.some((e) => e.data?.type === 'turn-interrupted'),
    false,
  )
})

test('an interruption is retained when an exhausted replay budget forbids retry', async () => {
  const { ctx, emitted } = retryContext()

  ctx.state.freshRetryAttempts = 3
  const read = await consumeChatStream(
    ctx,
    sse(interruption, { type: 'error', errorText: 'failed' }),
    false,
  )

  if (read.kind !== 'read') throw new Error('expected read')
  assert.equal(await resolveStreamOutcome(ctx, read, false, Date.now(), true), 'stop')
  assert.equal(
    emitted.some((e) => e.data?.type === 'turn-interrupted'),
    true,
  )
  assert.equal(
    emitted.some((e) => e.type === 'reset-partial'),
    false,
  )
})

test('an error frame after tool execution resumes the live run instead of failing the turn', async () => {
  for (const explicitResume of [false, true]) {
    const { ctx, emitted } = retryContext()

    ctx.explicitResume = explicitResume
    ctx.state.toolExecutionMayHaveStarted = !explicitResume
    const read = await consumeChatStream(
      ctx,
      sse(interruption, { type: 'error', errorText: 'Session is not attached to this connection' }),
      explicitResume,
    )

    if (read.kind !== 'read') throw new Error('expected read')
    // Throwing hands the attempt to startChat's reconnect ladder, which owns
    // the budget and only then surfaces a failure.
    await assert.rejects(
      () => resolveStreamOutcome(ctx, read, explicitResume, Date.now(), true),
      /Session is not attached to this connection/,
    )
    // The next attempt must re-attach where this one stopped, not replay.
    assert.equal(ctx.state.resumeFrom, 1)
    assert.equal(ctx.state.forceFreshStart, false)
    assert.equal(
      emitted.some((e) => e.type === 'error'),
      false,
    )
    assert.equal(
      emitted.some((e) => e.type === 'reset-partial'),
      false,
    )
    assert.equal(
      emitted.some((e) => e.data?.type === 'turn-interrupted'),
      false,
    )
  }
})

test('a stream that flaps between a frame and an error frame converges to one error', async () => {
  const { ctx, emitted } = retryContext()

  ctx.state.toolExecutionMayHaveStarted = true
  // Every legitimate frame resets reconnectAttempts, so the transport budget
  // alone would never trip on this pattern — the per-turn breakage budget must.
  for (let cycle = 1; cycle <= 4; cycle += 1) {
    const read = await consumeChatStream(
      ctx,
      sse({ type: 'text-delta', delta: 'x' }, { type: 'error', errorText: 'stream broke' }),
      true,
    )

    if (read.kind !== 'read') throw new Error('expected read')
    assert.equal(ctx.state.reconnectAttempts, 0)
    if (cycle <= 3) {
      await assert.rejects(() => resolveStreamOutcome(ctx, read, true, Date.now(), true))
    } else {
      assert.equal(await resolveStreamOutcome(ctx, read, true, Date.now(), true), 'stop')
    }
  }
  assert.equal(emitted.filter((e) => e.type === 'error').length, 1)
})

test('a trailing error frame of any code cannot reopen a delivered turn', async () => {
  const { ctx, emitted } = retryContext()
  const read = await consumeChatStream(
    ctx,
    sse(
      { type: 'tool-input-available', toolCallId: 'tool-1' },
      { type: 'atlas-turn-complete' },
      { type: 'error', errorText: 'Session is not attached to this connection' },
      { type: 'atlas-stream-done' },
    ),
    false,
  )

  if (read.kind !== 'read') throw new Error('expected read')
  assert.equal(read.needsFreshRetry, false)
  assert.equal(await resolveStreamOutcome(ctx, read, false, Date.now(), true), 'completed')
  assert.equal(
    emitted.some((e) => e.type === 'error'),
    false,
  )
})

test('an explicit stopped turn without a retryable error preserves its interruption notice', async () => {
  const { ctx, emitted } = retryContext()

  await consumeChatStream(
    ctx,
    sse({ ...interruption, reason: 'cancelled' }, { type: 'atlas-stream-done' }),
    false,
  )
  assert.equal(
    emitted.some((e) => e.data?.type === 'turn-interrupted'),
    true,
  )
})
