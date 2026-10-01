import { describe, expect, test } from 'bun:test'

import { classifyTurn, outcomeBody, plainText } from './turn-outcome'

const frame = (payload: Record<string, unknown>) => `data: ${JSON.stringify(payload)}\n\n`
const text = (delta: string) => frame({ type: 'text-delta', id: 't', delta })
const complete = frame({ type: 'atlas-turn-complete', finishReason: 'stop' })
const done = frame({ type: 'atlas-stream-done' })
const paused = (reason: string) => frame({ type: 'atlas-turn-paused', reason })

describe('classifyTurn', () => {
  test('a finished turn carries the text after its last tool call', () => {
    const frames = [
      text('Let me check. '),
      frame({ type: 'tool-input-start', toolCallId: 'c1', toolName: 'Terminal' }),
      frame({ type: 'tool-output-available', toolCallId: 'c1' }),
      text('The cache is '),
      text('**1.2 GB**.'),
      complete,
      done,
    ]

    const outcome = classifyTurn({ frames, aborted: false })

    expect(outcome).toEqual({ kind: 'finished', text: 'The cache is **1.2 GB**.' })
    expect(outcomeBody(outcome!, null)).toBe('The cache is 1.2 GB.')
  })

  test('an approval gate names the tool it waits on', () => {
    const frames = [
      frame({ type: 'tool-input-start', toolCallId: 'c9', toolName: 'rm -rf /tmp/cache' }),
      frame({ type: 'tool-approval-request', toolCallId: 'c9', approvalId: 'a1' }),
      complete,
      done,
    ]

    const outcome = classifyTurn({ frames, aborted: false, awaitingAuthorization: true })

    expect(outcome).toEqual({ kind: 'approval', toolName: 'rm -rf /tmp/cache' })
    expect(outcomeBody(outcome!, null)).toBe('Waiting for your approval: rm -rf /tmp/cache')
  })

  test('a runtime parked on a plan is an approval, and the plan number wins the body', () => {
    const outcome = classifyTurn({
      frames: [complete, done],
      aborted: false,
      awaitingDecision: 'plan',
    })

    expect(outcome).toEqual({ kind: 'approval' })
    expect(outcomeBody(outcome!, 12)).toBe('Plan #12 is waiting for approval')
  })

  test('a client-tool handoff is not a stop', () => {
    expect(
      classifyTurn({ frames: [complete, done], aborted: false, awaitingDecision: 'client-tool' }),
    ).toBeNull()
  })

  test('an error frame is a failure with its first line', () => {
    const frames = [
      text('Working'),
      frame({ type: 'error', errorText: 'Model provider unavailable\ncontext=phase=x' }),
      paused('stream-ended-without-result'),
      done,
    ]

    expect(classifyTurn({ frames, aborted: false })).toEqual({
      kind: 'failed',
      cause: 'Model provider unavailable',
    })
  })

  test('stalls and non-recoverable pauses fail; recoverable ones stay silent', () => {
    expect(classifyTurn({ frames: [paused('producer-stalled'), done], aborted: true })).toEqual({
      kind: 'failed',
      cause: 'The agent stopped before finishing this turn.',
    })
    expect(classifyTurn({ frames: [paused('content-filter'), done], aborted: false })?.kind).toBe(
      'failed',
    )
    for (const reason of ['model-silence', 'tool-execution-timeout', 'shutdown']) {
      expect(classifyTurn({ frames: [paused(reason), done], aborted: false })).toBeNull()
    }
  })

  test('a user stop stays silent', () => {
    const frames = [text('Half an answer'), paused('stream-ended-without-result'), done]

    expect(classifyTurn({ frames, aborted: true })).toBeNull()
  })

  test('a run with no terminal frame is not a stop', () => {
    expect(classifyTurn({ frames: [text('partial')], aborted: false })).toBeNull()
  })
})

describe('outcomeBody', () => {
  test('falls back when a finished turn said nothing', () => {
    expect(outcomeBody({ kind: 'finished', text: '' }, null)).toBe(
      'The agent finished without a text response.',
    )
  })

  test('truncates long answers', () => {
    const body = outcomeBody({ kind: 'finished', text: 'x'.repeat(500) }, null)

    expect(body).toHaveLength(201)
    expect(body.endsWith('…')).toBe(true)
  })
})

describe('plainText', () => {
  test('drops markdown syntax', () => {
    expect(
      plainText('# Title\n- see [docs](https://x.io)\n```ts\nconst a = 1\n```\n> _done_'),
    ).toBe('Title see docs (code) done')
  })
})
