import { beforeEach, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import { attributeAppMessages } from './message-attribution'

import type * as dbActual from '@/lib/db'
import type { UIMessage } from 'ai'

// Attribution and joining are the same event, so this pins that a teammate's
// first message records them on the conversation — and that nothing else does.
let updates: { collection: string; filter: unknown; update: unknown }[] = []

const collection = (name: string) => ({
  find: () => ({ toArray: async () => [] }),
  findOneAndUpdate: async (filter: unknown, update: unknown) => {
    updates.push({ collection: name, filter, update })

    return { sessionId: 'session', userId: 'owner' }
  },
})

useDb({ db: (() => ({ collection })) as unknown as typeof dbActual.db })

function userMessage(): UIMessage[] {
  return [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }] as UIMessage[]
}

beforeEach(() => {
  updates = []
})

test('a teammate speaking in the owner’s session joins it', async () => {
  await attributeAppMessages(userMessage(), 'session', 'owner', 'teammate', false)

  expect(updates).toEqual([
    {
      collection: 'agent_conversations',
      filter: { sessionId: 'session' },
      update: { $addToSet: { participantIds: { $each: ['teammate'] } } },
    },
  ])
})

test('the owner’s own turns and continuations record nothing', async () => {
  await attributeAppMessages(userMessage(), 'session', 'owner', 'owner', false)
  await attributeAppMessages(userMessage(), 'session', 'owner', 'teammate', true)

  expect(updates).toEqual([])
})
