import assert from 'node:assert/strict'
import { test } from 'node:test'

import { conversationActivity, liveActivityIndices } from './activity.ts'

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
