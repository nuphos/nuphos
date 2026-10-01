import { describe, expect, test } from 'bun:test'

import { SlackAgentRunSink } from './stream-sink'

const frame = (payload: Record<string, unknown>) => `data: ${JSON.stringify(payload)}\n\n`

// Captures the sink's posts without touching the Slack API. `failing` makes
// every post reject, exercising the best-effort delivery contract.
function makeSink(
  failing = false,
  onToolApprovalRequest?: (request: Record<string, unknown>) => Promise<void>,
) {
  const posts: string[] = []
  const statuses: string[] = []
  const sink = new SlackAgentRunSink(
    (text) => {
      if (failing) return Promise.reject(new Error('slack down'))
      posts.push(text)

      return Promise.resolve()
    },
    (text) => statuses.push(text),
    onToolApprovalRequest,
  )

  return { posts, statuses, sink }
}

const toolFrame = (id: string, label?: string, toolName = 'bash') =>
  frame({
    type: 'tool-input-available',
    toolCallId: id,
    toolName,
    input: label ? { label } : { command: 'ls' },
  })

describe('SlackAgentRunSink', () => {
  test('speaking, working, then speaking again lands as two separate messages', async () => {
    const { posts, sink } = makeSink()

    sink.frame(frame({ type: 'text-start', id: 'a' }))
    sink.frame(frame({ type: 'text-delta', id: 'a', delta: 'Let me check.' }))
    sink.frame(frame({ type: 'text-end', id: 'a' }))
    sink.frame(toolFrame('t1', 'Checking'))
    sink.frame(frame({ type: 'tool-output-available', toolCallId: 't1', output: { ok: true } }))
    sink.frame(frame({ type: 'text-start', id: 'b' }))
    sink.frame(frame({ type: 'text-delta', id: 'b', delta: 'Not installed — installing now.' }))
    sink.frame(frame({ type: 'atlas-turn-complete' }))
    await sink.settle()

    expect(posts).toEqual(['Let me check.', 'Not installed — installing now.'])
  })

  test('the pre-work utterance posts when the tool starts, not at the end of the turn', async () => {
    const { posts, sink } = makeSink()

    sink.frame(frame({ type: 'text-start', id: 'a' }))
    sink.frame(frame({ type: 'text-delta', id: 'a', delta: 'On it.' }))
    sink.frame(toolFrame('t1', 'Working'))
    // The turn is still running (no terminal frame, no settle) — the first
    // utterance must already be in the thread.
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(posts).toEqual(['On it.'])
  })

  test('text blocks with no work between them stay one message, blank-line separated', async () => {
    const { posts, sink } = makeSink()

    for (const [id, delta] of [
      ['a', 'Checking zones.'],
      ['b', 'Found the account.'],
    ] as const) {
      sink.frame(frame({ type: 'text-start', id }))
      sink.frame(frame({ type: 'text-delta', id, delta }))
      sink.frame(frame({ type: 'text-end', id }))
    }
    await sink.settle()

    expect(posts).toEqual(['Checking zones.\n\nFound the account.'])
  })

  test('an empty text block never injects a stray separator', async () => {
    const { posts, sink } = makeSink()

    sink.frame(frame({ type: 'text-start', id: 'a' }))
    sink.frame(frame({ type: 'text-delta', id: 'a', delta: 'Hello.' }))
    sink.frame(frame({ type: 'text-end', id: 'a' }))
    sink.frame(frame({ type: 'text-start', id: 'b' }))
    sink.frame(frame({ type: 'text-end', id: 'b' }))
    await sink.settle()

    expect(posts).toEqual(['Hello.'])
  })

  test('cardless tools neither split the utterance nor drive a status', async () => {
    const { posts, statuses, sink } = makeSink()

    sink.frame(frame({ type: 'text-start', id: 'a' }))
    sink.frame(frame({ type: 'text-delta', id: 'a', delta: 'One thought' }))
    sink.frame(toolFrame('t1', 'Loading skill', 'skill'))
    sink.frame(toolFrame('t2', undefined, 'slack_react'))
    sink.frame(frame({ type: 'text-start', id: 'b' }))
    sink.frame(frame({ type: 'text-delta', id: 'b', delta: 'continued.' }))
    await sink.settle()

    expect(posts).toEqual(['One thought\n\ncontinued.'])
    expect(statuses).toEqual([])
  })

  test('work before the agent has said anything posts no empty message', async () => {
    const { posts, sink } = makeSink()

    sink.frame(toolFrame('t1', 'Checking'))
    sink.frame(frame({ type: 'text-start', id: 'a' }))
    sink.frame(frame({ type: 'text-delta', id: 'a', delta: 'Here is what I found.' }))
    await sink.settle()

    expect(posts).toEqual(['Here is what I found.'])
  })

  test('a tool call becomes a status line', async () => {
    const { statuses, sink } = makeSink()

    sink.frame(toolFrame('t1', '檢查 prod cluster'))
    sink.frame(frame({ type: 'tool-output-available', toolCallId: 't1', output: { exitCode: 0 } }))
    sink.frame(frame({ type: 'atlas-turn-complete' }))
    await sink.settle()

    expect(statuses).toEqual(['檢查 prod cluster'])
    expect(sink.terminal()).toBe('complete')
  })

  test('a blocking tool approval is published immediately with the tool label', async () => {
    const approvals: Record<string, unknown>[] = []
    const { posts, statuses, sink } = makeSink(false, async (request) => {
      approvals.push(request)
    })

    sink.frame(frame({ type: 'text-start', id: 'a' }))
    sink.frame(frame({ type: 'text-delta', id: 'a', delta: 'I need to run one command.' }))
    sink.frame(toolFrame('tool-1', 'Fetch Azure billing data'))
    sink.frame(
      frame({
        type: 'tool-approval-request',
        toolCallId: 'tool-1',
        approvalId: 'openab:wait-1',
        options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }],
      }),
    )
    await sink.settle()

    expect(posts).toEqual(['I need to run one command.'])
    expect(statuses).toEqual(['Fetch Azure billing data', 'Waiting for approval'])
    expect(approvals).toEqual([
      {
        type: 'tool-approval-request',
        toolCallId: 'tool-1',
        approvalId: 'openab:wait-1',
        toolLabel: 'Fetch Azure billing data',
        options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }],
      },
    ])
  })

  test('reasoning shows Thinking, then the step that follows replaces it', async () => {
    const { statuses, sink } = makeSink()

    sink.frame(frame({ type: 'reasoning-start', id: 'r1' }))
    sink.frame(frame({ type: 'reasoning-delta', id: 'r1', delta: 'weighing options' }))
    sink.frame(frame({ type: 'reasoning-end', id: 'r1' }))
    sink.frame(toolFrame('t1', 'Running ls'))
    await sink.settle()

    expect(statuses).toEqual(['Thinking', 'Running ls'])
  })

  test('a repeated status is not re-sent', async () => {
    const { statuses, sink } = makeSink()

    sink.frame(toolFrame('t1', 'Same step'))
    sink.frame(toolFrame('t2', 'Same step'))
    await sink.settle()

    expect(statuses).toEqual(['Same step'])
  })

  test('a long label is clamped to a status-sized line', async () => {
    const { statuses, sink } = makeSink()

    sink.frame(toolFrame('t1', 'x'.repeat(300)))
    await sink.settle()

    expect(statuses[0]!.length).toBeLessThanOrEqual(80)
    expect(statuses[0]!.endsWith('…')).toBe(true)
  })

  test('an unlabelled tool falls back to its name', async () => {
    const { statuses, sink } = makeSink()

    sink.frame(toolFrame('t1', undefined, 'web_search'))
    await sink.settle()

    expect(statuses).toEqual(['web_search'])
  })

  test('an oversized utterance is split into consecutive messages', async () => {
    const { posts, sink } = makeSink()

    sink.frame(frame({ type: 'text-start', id: 'a' }))
    sink.frame(
      frame({ type: 'text-delta', id: 'a', delta: `${'a'.repeat(3000)}\n\n${'b'.repeat(3000)}` }),
    )
    await sink.settle()

    expect(posts).toEqual(['a'.repeat(3000), 'b'.repeat(3000)])
  })

  test('failed posts are swallowed and reported as no visible output', async () => {
    const { sink } = makeSink(true)

    sink.frame(frame({ type: 'text-start', id: 'a' }))
    sink.frame(frame({ type: 'text-delta', id: 'a', delta: 'Lost words.' }))
    await sink.settle()

    expect(sink.hasVisibleOutput()).toBe(false)
  })

  test('say() posts after everything the model said', async () => {
    const { posts, sink } = makeSink()

    sink.frame(frame({ type: 'text-start', id: 'a' }))
    sink.frame(frame({ type: 'text-delta', id: 'a', delta: 'Partial work.' }))
    sink.frame(frame({ type: 'atlas-turn-paused' }))
    await sink.settle()
    await sink.say('_Paused — reply to continue._')

    expect(posts).toEqual(['Partial work.', '_Paused — reply to continue._'])
    expect(sink.terminal()).toBe('paused')
  })

  test('replyTail keeps the closing words across utterances', async () => {
    const { sink } = makeSink()

    sink.frame(frame({ type: 'text-start', id: 'a' }))
    sink.frame(frame({ type: 'text-delta', id: 'a', delta: 'First part.' }))
    sink.frame(toolFrame('t1', 'Working'))
    sink.frame(frame({ type: 'text-start', id: 'b' }))
    sink.frame(frame({ type: 'text-delta', id: 'b', delta: 'Second part.' }))
    await sink.settle()

    expect(sink.replyTail()).toBe('First part.Second part.')
  })
})
