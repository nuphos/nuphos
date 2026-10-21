import { expect, test } from 'bun:test'

import { deliverOpenAbSessionUpdate } from './openab-acp-updates'
import { createPreviewAssistantPartAccumulator } from './preview-transcript'

import type { PreviewTextMetadata } from './preview-agent-update'

test('native message identity and phase reach prompt callbacks without guessing legacy phases', () => {
  const observed: unknown[][] = []
  const pending = [
    {
      onTextDelta: (...args: unknown[]) => {
        observed.push(args)
      },
    },
  ]
  const emit = (extra: Record<string, unknown>) =>
    deliverOpenAbSessionUpdate({
      cancelledSessions: new Set(),
      pending,
      notify: () => {},
      params: {
        sessionId: 'session',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'hello' },
          ...extra,
        },
      },
    })

  emit({ messageId: 'progress', _meta: { codex: { phase: 'commentary' } } })
  emit({ messageId: 'answer', _meta: { codex: { phase: 'final_answer' } } })
  emit({ _meta: { codex: { phase: 'unknown' } } })
  expect(observed).toEqual([
    ['hello', { messageId: 'progress', phase: 'commentary' }],
    ['hello', { messageId: 'answer', phase: 'final_answer' }],
    ['hello'],
  ])
})

test('adjacent native chunks retain message boundaries and phase', () => {
  const parts = createPreviewAssistantPartAccumulator()

  expect(parts.appendText('Checking ', { messageId: 'p', phase: 'commentary' })).toBe(true)
  expect(parts.appendText('the source.', { messageId: 'p', phase: 'commentary' })).toBe(false)
  expect(parts.appendText('Done.', { messageId: 'f', phase: 'final_answer' })).toBe(true)
  const expected: ({ type: 'text'; text: string } & PreviewTextMetadata)[] = [
    { type: 'text', text: 'Checking the source.', messageId: 'p', phase: 'commentary' },
    { type: 'text', text: 'Done.', messageId: 'f', phase: 'final_answer' },
  ]

  expect(parts.materialize([])).toEqual(expected)
})

test('a phase change starts a new part and a following legacy chunk resets metadata', () => {
  const parts = createPreviewAssistantPartAccumulator()

  parts.appendText('Checking', { messageId: 'same', phase: 'commentary' })
  expect(parts.appendText('Answer', { messageId: 'same', phase: 'final_answer' })).toBe(true)
  expect(parts.appendText('Legacy')).toBe(true)
  expect(parts.appendText(' continuation')).toBe(false)
  const values = parts.materialize([]) as ({ type: string; text: string } & PreviewTextMetadata)[]

  expect(values.map((part) => part.phase)).toEqual(['commentary', 'final_answer', undefined])
  expect(values.map((part) => part.text)).toEqual(['Checking', 'Answer', 'Legacy continuation'])
})
