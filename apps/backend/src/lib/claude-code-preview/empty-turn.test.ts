import { expect, test } from 'bun:test'

import { completedTurnOutput, isEmptyTurnText, withoutEmptyTurnSentinel } from './empty-turn'

test('drops only complete placeholder/blank text parts while keeping reasoning, tools and real text', () => {
  const parts = [
    { type: 'reasoning' as const, text: 'Keep the investigation.' },
    { type: 'text' as const, text: '_(no response)_' },
    { type: 'text' as const, text: 'The phrase (no response) names the symptom.' },
    { type: 'text' as const, text: '  ' },
  ]

  expect(withoutEmptyTurnSentinel(parts)).toEqual([parts[0]!, parts[2]!])
  expect(isEmptyTurnText(' \n(no response)\n ')).toBe(true)
  expect(isEmptyTurnText('No response from the provider: timed out.')).toBe(false)
})

test('cleans steered assistant segments and preserves user text and tool errors', () => {
  const tool = {
    type: 'dynamic-tool' as const,
    toolName: 'Terminal',
    toolCallId: 'synthetic',
    state: 'output-error' as const,
    input: {},
    errorText: 'Permission denied',
  }
  const result = completedTurnOutput(
    [
      { type: 'text', text: 'Checked the status.' },
      tool,
      { type: 'text', text: '_(no response)_' },
    ],
    [
      {
        id: 'earlier',
        role: 'assistant',
        parts: [
          { type: 'reasoning', text: 'Kept' },
          { type: 'text', text: '(no response)' },
        ],
      },
      { id: 'steer', role: 'user', parts: [{ type: 'text', text: '(no response)' }] },
    ],
  )

  expect(result.parts).toEqual([{ type: 'text', text: 'Checked the status.' }, tool])
  expect(result.steered[0]?.parts).toEqual([{ type: 'reasoning', text: 'Kept' }])
  expect(result.steered[1]?.parts).toEqual([{ type: 'text', text: '(no response)' }])
  expect(result.answer).toBe('Checked the status.')
})
