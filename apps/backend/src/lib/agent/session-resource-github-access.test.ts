import { expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useByosAccount } from '@/lib/test/doubles/byos-account'
import { useIdentity } from '@/lib/test/doubles/identity'

import { resourceCredentialAllowed } from './session-resource-lookup'

import type { AgentConversation } from './db'
import type { BindingAccess } from '@/models'

let access: BindingAccess | undefined

useIdentity({ getTeamMembership: async () => ({ role: 'MEMBER' }) })
useByosAccount({ findGithubInstallation: async () => ({ installationId: 7, access }) })

const conversation = {
  sessionId: 'session',
  userId: 'owner',
  teamId: new ObjectId().toHexString(),
  credentialAccess: { githubInstallationIds: ['7'] },
} as unknown as AgentConversation
const allowed = (actorId: string) =>
  resourceCredentialAllowed(conversation, { provider: 'github', integrationId: '7' }, actorId)
const listOf = (memberAllowList: string[]) => ({
  memberAllowList,
  updatedAt: new Date(),
  updatedBy: 'admin',
})

test('a GitHub installation without a list stays open to the conversation', async () => {
  access = undefined
  expect(await allowed('owner')).toBe(true)
})

test('a GitHub installation is refused unless the sender and the owner are both listed', async () => {
  access = listOf(['owner'])
  expect(await allowed('owner')).toBe(true)
  expect(await allowed('teammate')).toBe(false)
  access = listOf(['teammate'])
  expect(await allowed('teammate')).toBe(false)
  access = listOf(['owner', 'teammate'])
  expect(await allowed('teammate')).toBe(true)
})
