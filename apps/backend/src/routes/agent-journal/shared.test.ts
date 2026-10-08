import { beforeEach, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import type { AgentConversation } from '@/lib/agent/db'
import type * as dbActual from '@/lib/db'

let memory = portabilityDb()

useDb({ db: (() => memory) as unknown as typeof dbActual.db })

const { assertJournalSessionsReadable, journalConversationTitle, unreadableSessionIds } =
  await import('./shared')

const TEAM = 'team'

beforeEach(() => {
  memory = portabilityDb()
  memory.rows('agent_conversations').push(
    { sessionId: 'private', userId: 'owner', teamId: TEAM, generalAccess: 'none', title: 'Secret' },
    {
      sessionId: 'invited',
      userId: 'owner',
      teamId: TEAM,
      generalAccess: 'none',
      participantIds: ['viewer'],
      viewOnlyIds: ['viewer'],
      title: 'Shared',
    },
    { sessionId: 'legacy', userId: 'owner', teamId: TEAM, title: 'Team' },
  )
})

test('only sessions the viewer may not open are withheld', async () => {
  const ids = ['private', 'invited', 'legacy', 'gone']

  expect([...(await unreadableSessionIds(ids, 'viewer'))]).toEqual(['private'])
  expect([...(await unreadableSessionIds(ids, 'owner'))]).toEqual([])
})

test('asking for a private session by id answers not found', async () => {
  await expect(assertJournalSessionsReadable(['private'], 'viewer')).rejects.toMatchObject({
    status: 404,
  })
  await assertJournalSessionsReadable(['invited', 'legacy'], 'viewer')
  await assertJournalSessionsReadable(['private'], 'owner')
})

test('a private title is withheld from anyone it was not shared with', () => {
  const secret = memory.rows('agent_conversations')[0] as AgentConversation

  expect(journalConversationTitle(secret, 'viewer')).toBe('Private session')
  expect(journalConversationTitle(secret, 'owner')).toBe('Secret')
})
