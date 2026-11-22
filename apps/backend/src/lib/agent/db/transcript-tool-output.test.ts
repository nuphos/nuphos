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
