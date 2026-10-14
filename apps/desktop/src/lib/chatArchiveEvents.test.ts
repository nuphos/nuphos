import assert from 'node:assert/strict'
import { before, test } from 'node:test'

import type { ChatArchiveChange } from './chatArchiveEvents.ts'

let events: typeof import('./chatArchiveEvents.ts')

before(async () => {
  // The announcements ride window events; a bare EventTarget stands in for it.
  Object.assign(globalThis, { window: new EventTarget() })
  events = await import('./chatArchiveEvents.ts')
})

test('an archive announcement reaches every listener until it unsubscribes', () => {
  const seen: ChatArchiveChange[] = []
  const stop = events.onChatArchived((change) => seen.push(change))

  events.announceChatArchived({ sessionId: 's1', teamId: 't1' })
  stop()
  events.announceChatArchived({ sessionId: 's2', teamId: 't1' })

  assert.deepEqual(seen, [{ sessionId: 's1', teamId: 't1' }])
})

test('archive and unarchive announcements stay on their own channels', () => {
  const archived: string[] = []
  const unarchived: string[] = []
  const stopArchived = events.onChatArchived((change) => archived.push(change.sessionId))
  const stopUnarchived = events.onChatUnarchived((sessionId) => unarchived.push(sessionId))

  events.announceChatUnarchived('s1')
  events.announceChatArchived({ sessionId: 's2', teamId: 't1' })
  stopArchived()
  stopUnarchived()

  assert.deepEqual(archived, ['s2'])
  assert.deepEqual(unarchived, ['s1'])
})
