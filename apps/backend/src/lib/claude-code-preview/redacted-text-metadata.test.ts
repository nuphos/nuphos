import { expect, test } from 'bun:test'

import { mintPreviewMcpToken } from './mcp-token'
import { redactedPromptUpdates } from './redacted-prompt-updates'
import { redactStreamedUpdates } from './streamed-token-redaction'

import type { OpenAbSessionUpdate } from './openab-acp-updates'

test('redaction retains native owners for ordinary text held across a message boundary', () => {
  const seen: OpenAbSessionUpdate[] = []
  const live = redactStreamedUpdates((update) => seen.push(update))

  live.deliver({ kind: 'text', text: 'Checking the key', messageId: 'p', phase: 'commentary' })
  live.deliver({ kind: 'text', text: 'Done.', messageId: 'f', phase: 'final_answer' })
  live.flush()
  const texts = seen.filter((update) => update.kind === 'text')

  expect(
    texts
      .filter((part) => part.messageId === 'p')
      .map((part) => part.text)
      .join(''),
  ).toBe('Checking the key')
  expect(
    texts
      .filter((part) => part.messageId === 'f')
      .map((part) => part.text)
      .join(''),
  ).toBe('Done.')
  expect(
    texts.filter((part) => part.messageId === 'p').every((part) => part.phase === 'commentary'),
  ).toBe(true)
  expect(
    texts.filter((part) => part.messageId === 'f').every((part) => part.phase === 'final_answer'),
  ).toBe(true)
})

test('a backend token spanning native messages remains redacted without a guessed phase', () => {
  const token = mintPreviewMcpToken({ userId: 'u1', sessionId: 'conv-1', teamId: 't1' })
  const split = Math.floor(token.length / 2)
  const seen: OpenAbSessionUpdate[] = []
  const live = redactStreamedUpdates((update) => seen.push(update))

  live.deliver({ kind: 'text', text: token.slice(0, split), messageId: 'p', phase: 'commentary' })
  live.deliver({
    kind: 'text',
    text: `${token.slice(split)} done`,
    messageId: 'f',
    phase: 'final_answer',
  })
  live.flush()
  const texts = seen.filter((update) => update.kind === 'text')

  expect(texts.map((part) => part.text).join('')).toBe('[redacted] done')
  expect(texts.every((part) => part.phase === undefined && part.messageId === undefined)).toBe(true)
})

test('prompt redaction forwards native metadata while preserving legacy callback arity', () => {
  const observed: unknown[][] = []
  const prompt = redactedPromptUpdates((...args) => observed.push(args))

  prompt.onTextDelta('Progress.', { messageId: 'p', phase: 'commentary' })
  prompt.onTextDelta('Answer.', { messageId: 'f', phase: 'final_answer' })
  prompt.onTextDelta('Legacy.')
  prompt.flush()
  expect(observed).toEqual([
    ['Progress.', { messageId: 'p', phase: 'commentary' }],
    ['Answer.', { messageId: 'f', phase: 'final_answer' }],
    ['Legacy.'],
  ])
})
