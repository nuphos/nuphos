import { expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import { getAgentCredentialAccess } from './shared'

import type * as dbActual from '@/lib/db'

type Doc = Record<string, unknown>

const docs: Doc[] = [
  {
    sessionId: 'bot',
    userId: 'owner',
    teamId: 'team',
    credentialAccess: { awsRoleIds: ['role-1'], deviceIds: ['mac-mini'] },
  },
  {
    sessionId: 'task',
    userId: 'owner',
    teamId: 'team',
    parentSessionId: 'bot',
    credentialAccess: { awsRoleIds: ['stale'], deviceIds: [] },
  },
]
// Equality on plain fields; operators ($ne, $or) are what the parent lookup adds.
const matches = (doc: Doc, filter: Doc) =>
  Object.entries(filter).every(
    ([key, want]) => key.startsWith('$') || typeof want === 'object' || doc[key] === want,
  )

useDb({
  db: (() => ({
    collection: () => ({
      findOne: async (filter: Doc) => docs.find((doc) => matches(doc, filter)) ?? null,
    }),
  })) as unknown as typeof dbActual.db,
})

test("a Task under a Bot gets the Bot's credentials and computers, not its own", async () => {
  const access = await getAgentCredentialAccess({ userId: 'owner', sessionId: 'task' }, 'team')

  expect(access.awsRoleIds).toEqual(['role-1'])
  expect(access.deviceIds).toEqual(['mac-mini'])
})

test('someone else cannot read a Task through its Bot', async () => {
  await expect(
    getAgentCredentialAccess(
      { userId: 'other', conversationOwnerUserId: 'other', sessionId: 'task' },
      'team',
    ),
  ).rejects.toThrow('not owned')
})
