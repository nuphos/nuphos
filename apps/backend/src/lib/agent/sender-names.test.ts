import { beforeEach, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import { agentConversations } from './db'
import { withCurrentAgentNames } from './sender-names'

import type { MessageMetadata } from './message-metadata'

let memory = portabilityDb()

useDb({ db: () => memory })

const from = (type: 'user' | 'agent', id: string, displayName: string) => ({
  metadata: {
    version: 1,
    sender: { type, id, displayName },
    source: type === 'user' ? 'nuphos' : 'agent.thread',
    sentAt: '2026-11-15T00:00:00Z',
  } as MessageMetadata,
})

beforeEach(async () => {
  memory = portabilityDb()
  await agentConversations().insertOne({
    sessionId: 'bot',
    userId: 'me',
    teamId: 'team',
    title: 'Nuphos Account Manager',
  } as never)
})

test("an agent's messages carry the name it has now, not the one it posted under", async () => {
  const [old, person, gone] = await withCurrentAgentNames(
    [from('agent', 'bot', 'Nuphos CSM'), from('user', 'bot', 'Ann'), from('agent', 'gone', 'Gone')],
    'team',
  )

  expect(old?.metadata.sender.displayName).toBe('Nuphos Account Manager')
  // Only agents are looked up, and one that no longer exists keeps its stored name.
  expect(person?.metadata.sender.displayName).toBe('Ann')
  expect(gone?.metadata.sender.displayName).toBe('Gone')
})

test("another team's agent never lends its name", async () => {
  const [message] = await withCurrentAgentNames([from('agent', 'bot', 'Nuphos CSM')], 'other')

  expect(message?.metadata.sender.displayName).toBe('Nuphos CSM')
})
