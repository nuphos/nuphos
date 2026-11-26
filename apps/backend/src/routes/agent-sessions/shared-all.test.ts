import { expect, test } from 'bun:test'

import { options } from '@/lib/test/credential-options-fixture'
import { useCredentialOptions } from '@/lib/test/doubles/credential-options'
import { useDb } from '@/lib/test/doubles/db'

import { getAgentCredentialAccess } from './shared'

import type * as dbActual from '@/lib/db'
import type { AgentCredentialOptions } from '@/routes/agent/types'

type Doc = Record<string, unknown>

// A Bot saved with All before anything was connected, and a Task under it.
const docs: Doc[] = [
  {
    sessionId: 'bot',
    userId: 'owner',
    teamId: 'team',
    credentialAccess: { allCredentials: true, allDevices: true, awsRoleIds: [], deviceIds: [] },
  },
  { sessionId: 'task', userId: 'owner', teamId: 'team', parentSessionId: 'bot' },
]
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

// What each member can use now: the owner has since connected role-1 and a Mac.
const mate: AgentCredentialOptions = {
  ...options,
  awsRoles: [],
  resendIntegrations: [],
  devices: [],
}

useCredentialOptions({
  getAgentCredentialOptions: async (_team, userId) => (userId === 'owner' ? options : mate),
})

test('a Task under a Bot with All gets what the owner connected since', async () => {
  const access = await getAgentCredentialAccess({ userId: 'owner', sessionId: 'task' }, 'team')

  expect(access.awsRoleIds).toEqual(['role-1'])
  expect(access.resendIntegrationIds).toEqual(['mail'])
  expect(access.deviceIds).toEqual(['mac'])
})

test("a teammate's turn does not inherit the owner's All", async () => {
  const access = await getAgentCredentialAccess(
    { userId: 'mate', conversationOwnerUserId: 'owner', sessionId: 'task' },
    'team',
  )

  expect(access.awsRoleIds).toEqual([])
  expect(access.resendIntegrationIds).toEqual([])
  expect(access.deviceIds).toEqual([])
})
