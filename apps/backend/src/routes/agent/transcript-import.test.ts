import { expect, test } from 'bun:test'

import { isTranscriptImport } from './transcript-import'

import type { AgentConversation } from '@/lib/agent/db'

const stored = {
  sessionId: 's',
  userId: 'owner',
  title: '',
  firstMessage: '',
  messageCount: 2,
  createdAt: new Date(),
  lastActiveAt: new Date(),
} satisfies AgentConversation

test('the owner may keep appending an import where it ends', () => {
  expect(isTranscriptImport(true, stored, 'owner', 2)).toBe(true)
  expect(isTranscriptImport(true, stored, 'owner', 1)).toBe(false)
  expect(isTranscriptImport(true, stored, 'someone-else', 2)).toBe(false)
})

test('nothing is imported into a channel', () => {
  expect(isTranscriptImport(true, { ...stored, kind: 'channel' }, 'owner', 2)).toBe(false)
})
