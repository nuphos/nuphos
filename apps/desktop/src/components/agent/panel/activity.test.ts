import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  conversationActivity,
  failedCallCount,
  liveActivityIndices,
  toolFailure,
} from './activity.ts'

import type { Message } from './model.ts'
import type { Part, ToolPart } from './parts.ts'

const text = (value: string, phase?: 'commentary' | 'final_answer'): Part => ({
  type: 'text',
  text: value,
  ...(phase ? { phase } : {}),
})
const tool = (
  state: ToolPart['state'] = 'output-available',
  extra: Partial<ToolPart> = {},
): ToolPart => ({ type: 'tool', toolName: 'bash', toolCallId: 'call', state, ...extra })
const message = (id: string, ...parts: Part[]): Message => ({ id, role: 'assistant', parts })

test('routine continuations share a fold but latest commentary and final answers stay visible', () => {
  const messages = [
    message('a', text('Checking', 'commentary')),
    message('b', tool()),
    message('c', text('Tests pass', 'commentary')),
    message('d', text('Done', 'final_answer')),
  ]
  const activity = conversationActivity(messages)

  assert.deepEqual([...activity.hidden], ['a', 'b', 'c'])
  assert.deepEqual(activity.before.get('d'), messages.slice(0, 3))
  assert.deepEqual([...conversationActivity(messages.slice(0, 3)).hidden], ['a', 'b'])
})

test('unknown text, questions, cards, failed commands and approvals are retained', () => {
  for (const part of [
    text('Question?'),
    text('Answer', 'final_answer'),
    tool('output-error'),
    tool('approval-requested'),
    tool('input-available'),
    tool('output-available', { toolName: 'render_chart' }),
    tool('output-available', { output: { exit_code: 6 } }),
    tool('output-available', { output: { isError: true } }),
    tool('output-available', { output: { error: 'upload_failed' } }),
    tool('output-available', { toolName: 'local_upload', output: '{"error":"upload_failed"}' }),
    tool('output-available', {
      toolName: 'local_upload',
      output: [{ type: 'text', text: '{"error":"upload_failed"}' }],
    }),
  ]) {
    assert.equal(
      conversationActivity([message('a', part), message('b', text('Current', 'commentary'))]).hidden
        .size,
      0,
    )
  }
})

test('folding cannot cross user input, timeline events, or files', () => {
  const before = message('a', text('Before', 'commentary'))
  const latest = message('b', text('Latest', 'commentary'))

  assert.equal(
    conversationActivity([
      before,
      { id: 'user', role: 'user', parts: [text('Correction')] },
      latest,
    ]).hidden.size,
    0,
  )
  assert.equal(conversationActivity([before, latest], new Set(), new Set(['b'])).hidden.size, 0)
  assert.equal(conversationActivity([before, latest], new Set(['b'])).hidden.has('b'), false)
  assert.equal(conversationActivity([before, latest], new Set(['a'])).hidden.size, 0)
})

test('live folding keeps the newest text and active tool outside the log', () => {
  const parts = [
    text('Earlier', 'commentary'),
    tool(),
    text('Current', 'commentary'),
    tool('input-available'),
  ]

  assert.deepEqual([...liveActivityIndices(parts)], [0, 1])
  assert.deepEqual([...liveActivityIndices([text('Unknown'), tool(), text('Current')])], [1])
  assert.deepEqual(
    [
      ...liveActivityIndices([
        ...parts,
        {
          type: 'turn-interrupted',
          id: 'stop',
          reason: 'cancelled',
          message: 'Stopped',
          createdAt: '',
        },
      ]),
    ],
    [],
  )
})

test('a finished call is marked failed when it threw, flagged an error, or returned one', () => {
  assert.equal(toolFailure(tool('output-error', { errorText: 'boom' })), '')
  assert.equal(toolFailure(tool('output-available', { output: { isError: true } })), '')
  assert.equal(
    toolFailure(tool('output-available', { output: { error: 'file_transfer_rate_limited' } })),
    'file transfer rate limited',
  )
  assert.equal(
    toolFailure(
      tool('output-available', { output: { error: 'You are no longer a member of this team.' } }),
    ),
    'You are no longer a member of this team.',
  )
})

test('successes, running calls and command exit codes are not marked failed', () => {
  for (const part of [
    tool('output-available', { output: { groupId: 'g', fileName: 'a.png', size: 1 } }),
    tool('output-available', { output: { error: '' } }),
    tool('output-available', { output: { error: null } }),
    tool('output-available', { output: { ok: true, error: 'already_reacted' } }),
    tool('output-available', { output: [{ error: 'not a result object' }] }),
    tool('output-available', { output: 'error' }),
    tool('output-available', { output: { exit_code: 1 } }),
    tool('output-available'),
    tool('input-available'),
  ])
    assert.equal(toolFailure(part), null)
})

test('a run counts its failed calls by the same rule as each row', () => {
  assert.equal(
    failedCallCount([
      tool('output-available', { output: { stdout: 'ok', exitCode: 0 } }),
      tool('output-error', { errorText: 'boom' }),
      tool('output-available', { output: { error: 'file_not_found' } }),
      tool('output-available', { output: { isError: true } }),
      tool('output-available', { output: { ok: true, error: 'already_reacted' } }),
      tool('output-available', { output: { exit_code: 1 } }),
      tool('input-available'),
    ]),
    3,
  )
  assert.equal(failedCallCount([tool('output-available'), tool('output-available')]), 0)
})

// The backend's MCP result for `{ error }`: its JSON text, as the content blocks Claude Code
// reports as rawOutput, or as the text alone.
const backendText = (value: unknown) => JSON.stringify(value, null, 2)
const blocks = (value: string) => [{ type: 'text', text: value }]
const upload = (output: unknown) => tool('output-available', { toolName: 'local_upload', output })

test('a returned error is read from JSON text and from MCP text content too', () => {
  const failed = backendText({ error: 'file_not_found' })

  assert.equal(toolFailure(upload(blocks(failed))), 'file not found')
  assert.equal(toolFailure(upload(failed)), 'file not found')
  assert.equal(
    failedCallCount([upload(blocks(failed)), upload(failed), upload({ error: 'file_not_found' })]),
    3,
  )
})

test('text results without an error are not marked failed', () => {
  for (const output of [
    blocks('Uploaded q3-report.pdf, no error.'),
    'There was an error in the report, so I fixed it.',
    blocks(backendText({ groupId: 'g', fileName: 'a.png', size: 1 })),
    backendText({ groupId: 'g', fileName: 'a.png', size: 1 }),
    blocks(backendText({ error: null })),
    blocks(backendText({ error: '' })),
    backendText({ error: '  ' }),
    blocks(backendText({ ok: true, error: 'already_reacted' })),
    blocks(backendText([{ error: 'not a result object' }])),
    blocks(backendText({ exit_code: 1 })),
    [{ type: 'image', data: '', mimeType: 'image/png' }],
  ])
    assert.equal(toolFailure(upload(output)), null, JSON.stringify(output))
  // A text block that is not JSON fails only when the result itself says isError.
  assert.equal(toolFailure(upload({ isError: true, content: blocks('boom') })), '')
})

test("JSON a shell command printed is its stdout, not the tool's error", () => {
  for (const toolName of ['bash', 'local_exec']) {
    const printed = tool('output-available', { toolName, output: '{"error":"rate_limited"}' })

    assert.equal(toolFailure(printed), null)
    assert.equal(
      conversationActivity([message('a', printed), message('b', text('Now', 'commentary'))]).hidden
        .size,
      1,
    )
    assert.equal(toolFailure({ ...printed, output: blocks('{"error":"rate_limited"}') }), null)
  }
})
