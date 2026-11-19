import { expect, test } from 'bun:test'

import { transcriptTailFrame } from './errors'

const at = (messageId: string, role: 'user' | 'assistant') => ({
  messageId,
  role,
  parts: [],
  createdAt: new Date('2026-11-17T00:00:00.000Z'),
})

test('a recent window gives the same frame as the whole transcript, at the same index', () => {
  const all = [
    at('m0', 'user'),
    at('m1', 'assistant'),
    at('m2', 'user'),
    at('m3', 'user'),
    at('reply', 'assistant'),
  ]
  const whole = transcriptTailFrame(all as never, 4)
  const window = transcriptTailFrame(all.slice(2) as never, 4, 2)

  expect(window).toEqual(whole)
  expect(window).toMatchObject({ messagesFirstIndex: 3 })
})
