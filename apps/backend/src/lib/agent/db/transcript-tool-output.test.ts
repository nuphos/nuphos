import { expect, test } from 'bun:test'

import { withoutToolOutputs } from './transcript-tool-output'

test('a tool result is not stored, but the tool still reads as completed', () => {
  const read = {
    type: 'tool',
    toolCallId: 'read',
    toolName: 'Read File',
    state: 'output-available',
    input: { file_path: 'screenshots/shot.png' },
    output: [{ type: 'image', source: { type: 'base64', data: 'AAAA' } }],
    completedAt: 1,
  }
  const failed = {
    type: 'tool-exec',
    toolCallId: 'exec',
    state: 'output-error',
    output: 'partial',
    errorText: 'exit 1',
  }

  expect(withoutToolOutputs([read, failed])).toEqual([
    {
      type: 'tool',
      toolCallId: 'read',
      toolName: 'Read File',
      state: 'output-available',
      input: { file_path: 'screenshots/shot.png' },
      completedAt: 1,
    },
    { type: 'tool-exec', toolCallId: 'exec', state: 'output-error', errorText: 'exit 1' },
  ])
})

test('results a client renders a card from are stored', () => {
  const parts = [
    { type: 'tool', toolCallId: 'p', toolName: 'plan_create', output: { planId: 'plan' } },
    { type: 'tool-render_chart', toolCallId: 'c', output: { series: [] } },
    // A question's answer is matched to its card by the request id its result names.
    {
      type: 'tool',
      toolCallId: 'q',
      toolName: 'request_user_decision',
      output: { status: 'awaiting_user_decision', requestId: 'nuphos-1' },
    },
    // A thread card names the agent each message ran on, from its receipt.
    {
      type: 'tool',
      toolCallId: 's',
      toolName: 'send_message_to_thread',
      output: { threadId: 't', runtimeLabel: "Yuanlin's Box" },
    },
    { type: 'text', text: 'done' },
    { type: 'data-steering', output: 'not a tool' },
  ]

  expect(withoutToolOutputs(parts)).toEqual(parts)
})

const part = (toolName: string, output: unknown) => ({
  type: `tool-${toolName}`,
  toolCallId: toolName,
  state: 'output-available',
  output,
})

test('a failed result keeps its reason, so the reloaded row still reads as failed', () => {
  // local_upload's missing file, as the content blocks Claude Code reports as rawOutput.
  const missing = [{ type: 'text', text: JSON.stringify({ error: 'file_not_found' }, null, 2) }]
  const flagged = {
    content: [{ type: 'text', text: 'file not found' }],
    isError: true,
    _meta: { 'ai.nuphos/toolPresentation': 'runtime' },
  }

  expect(
    withoutToolOutputs([
      part('local_upload', missing),
      part('local_upload', { error: 'file_transfer_rate_limited', retryAfterSeconds: 60 }),
      part('connector_call', flagged),
      part('connector_call', { result: { ...flagged, content: [] }, error: null }),
      part('local_exec', { error: 'device_unavailable' }),
    ]),
  ).toEqual([
    part('local_upload', { error: 'file_not_found' }),
    part('local_upload', { error: 'file_transfer_rate_limited' }),
    part('connector_call', { error: 'file not found' }),
    part('connector_call', { isError: true }),
    part('local_exec', { error: 'device_unavailable' }),
  ])
})

test('a result that did not fail is still left out', () => {
  for (const [toolName, output] of [
    ['local_upload', { groupId: 'g', fileName: 'a.txt', size: 1 }],
    ['local_upload', { ok: true, error: 'already_reacted' }],
    ['local_upload', { error: '  ' }],
    ['local_upload', [{ type: 'text', text: 'There was an error, so I fixed it.' }]],
    ['local_upload', { isError: false, content: [{ type: 'text', text: 'fine' }] }],
    // A shell's text is its stdout: JSON a command printed is not the tool's error.
    ['local_exec', '{"error":"rate_limited"}'],
    ['bash', [{ type: 'text', text: '{"error":"rate_limited"}' }]],
  ] as const) {
    const stored = { type: `tool-${toolName}`, toolCallId: 'u', state: 'output-available' }

    expect(withoutToolOutputs([{ ...stored, output }])).toEqual([stored])
  }
})
