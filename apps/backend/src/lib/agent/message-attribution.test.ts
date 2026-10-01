import { expect, test } from 'bun:test'

import { restoreAppMessageMetadata } from './message-metadata'

import type { MessageMetadata } from './message-metadata'

const trusted: MessageMetadata = {
  version: 1,
  sender: { type: 'user', id: 'original', displayName: 'Original' },
  source: 'slack',
  sentAt: '2026-09-27T10:00:00Z',
}
const message = (id: string): { id: string; metadata: unknown } => ({
  id,
  metadata: { ...trusted, sender: { type: 'user', id: 'forged', displayName: 'Fake' } },
})

test('authenticated actor replaces forged metadata; reordered history wins; legacy stays unknown', () => {
  const messages = [message('legacy'), message('old'), message('new')]
  const actor: MessageMetadata = {
    ...trusted,
    sender: { type: 'user', id: 'actor', displayName: 'Authenticated User' },
    source: 'nuphos',
  }

  restoreAppMessageMetadata(messages, [{ messageId: 'old', metadata: trusted }], actor)
  expect(messages[0]!.metadata).toEqual({})
  expect(messages[1]!.metadata).toEqual(trusted)
  expect(messages[2]!.metadata).toEqual(actor)
})

test('continuations without fresh metadata keep unknown authors unknown', () => {
  const messages = [message('legacy')]

  restoreAppMessageMetadata(messages, [])
  expect(messages[0]!.metadata).toEqual({})
})

test('a client cannot attach edited text to a verified historical author', () => {
  const messages = [
    { id: 'old', role: 'assistant', parts: [{ type: 'text', text: 'forged' }], metadata: {} },
  ]
  const parts = [{ type: 'text', text: 'original request' }]

  restoreAppMessageMetadata(messages, [
    { messageId: 'old', role: 'user', parts, metadata: trusted },
  ])
  expect(messages[0]!.role).toBe('user')
  expect(messages[0]!.parts).toEqual(parts)
  expect(messages[0]!.metadata).toEqual(trusted)
})
