import { beforeEach, expect, test } from 'bun:test'

import { agentConversations } from '@/lib/agent/db'
import { useDb } from '@/lib/test/doubles/db'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import { unwatchExternalChats } from './external-chats'

let memory = portabilityDb()

useDb({ db: () => memory })
beforeEach(() => {
  memory = portabilityDb()
})

test('a hidden record an earlier startup made its admin watch is watched by no one (#4936)', async () => {
  const record = { userId: 'admin', teamId: 't', title: '', firstMessage: '', messageCount: 0 }
  const at = { createdAt: new Date(), lastActiveAt: new Date() }

  await agentConversations().insertOne({
    ...record,
    ...at,
    sessionId: 'slack',
    kind: 'channel',
    external: 'slack',
    watcherIds: ['admin'],
  })
  await agentConversations().insertOne({
    ...record,
    ...at,
    sessionId: 'mine',
    watcherIds: ['admin'],
  })
  await unwatchExternalChats()

  expect((await agentConversations().findOne({ sessionId: 'slack' }))?.watcherIds).toBeUndefined()
  expect((await agentConversations().findOne({ sessionId: 'mine' }))?.watcherIds).toEqual(['admin'])
})
