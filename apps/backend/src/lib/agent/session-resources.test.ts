import { beforeEach, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { invalidateInstallationToken } from '@/lib/byos/github'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useByosAccount } from '@/lib/test/doubles/byos-account'
import { useGithubAppAuth } from '@/lib/test/doubles/github-app-auth'
import { useGithubHttp } from '@/lib/test/doubles/github-http'
import { useIdentity } from '@/lib/test/doubles/identity'

import { authorizedResourceTurn } from './resource-webhook'
import {
  bindSessionResource,
  resourceConversation,
  resourceCredentialAllowed,
  sessionResourceInput,
  unlinkSessionResource,
} from './session-resources'

import type { AgentConversation } from './db'
import type { SessionResource } from './session-resources'

const teamId = new ObjectId().toHexString()
const resource: SessionResource = {
  id: 'binding-id',
  key: 'github/12/34/56',
  provider: 'github',
  integrationId: '12',
  resourceId: '34/56',
  title: 'PR',
  state: 'open',
  url: 'https://github.com/org/repo/pull/56',
  linkedAt: new Date().toISOString(),
}
let conversation: AgentConversation
let membership = true
let connected = true
let updates: unknown[] = []
let lookupCount = 0

useIdentity({ getTeamMembership: async () => (membership ? { role: 'MEMBER' } : null) })
useByosAccount({
  findGithubInstallation: async () => (connected ? { installationId: 12 } : null),
})
useAgentDb({
  getConversationBySessionId: async () => conversation,
  agentConversations: () => ({
    updateOne: async (...args: unknown[]) => {
      updates.push(args)

      return { modifiedCount: 1 }
    },
  }),
})
useGithubAppAuth({ generateAppJwt: () => 'test-jwt' })
useGithubHttp({
  githubFetch: async (url) => {
    lookupCount++
    if (url.includes('/access_tokens'))
      return Response.json({ token: 'test-token', expires_at: '2099-01-01T00:00:00Z' })

    return Response.json({
      number: 56,
      title: 'Verified PR',
      state: 'open',
      merged: false,
      base: { repo: { id: 34, full_name: 'org/repo' } },
    })
  },
})
beforeEach(() => {
  invalidateInstallationToken(12)
  lookupCount = 0
  membership = true
  connected = true
  updates = []
  conversation = {
    sessionId: 'session',
    userId: 'owner',
    teamId,
    generalAccess: 'none',
    linkedResources: [resource],
    credentialAccess: { githubInstallationIds: ['12'] },
  } as AgentConversation
})
const actor = { userId: 'owner', teamId, sessionId: 'session' }
const delivery = {
  sessionId: 'session',
  resourceId: resource.id,
  messageId: 'delivery',
  summary: 'review submitted',
}

test('cross-team and non-participant reads fail closed', async () => {
  await expect(
    resourceConversation({ ...actor, teamId: new ObjectId().toHexString() }),
  ).rejects.toThrow('not found')
  await expect(resourceConversation({ ...actor, userId: 'stranger' })).rejects.toThrow('not found')
})
test('reply-only participants cannot enable autonomous wakeups', async () => {
  conversation.participantIds = ['participant']
  await expect(resourceConversation({ ...actor, userId: 'participant' }, true)).rejects.toThrow(
    'owner or manager',
  )
  conversation.managerIds = ['participant']
  expect(await resourceConversation({ ...actor, userId: 'participant' }, true)).toBe(conversation)
})
test('worker rechecks archive, unlink, membership, selection and disconnected integrations', async () => {
  expect(await authorizedResourceTurn(delivery)).not.toBeNull()
  conversation.archivedAt = new Date()
  expect(await authorizedResourceTurn(delivery)).toBeNull()
  delete conversation.archivedAt
  conversation.linkedResources = []
  expect(await authorizedResourceTurn(delivery)).toBeNull()
  conversation.linkedResources = [resource]
  membership = false
  expect(await authorizedResourceTurn(delivery)).toBeNull()
  membership = true
  connected = false
  expect(await authorizedResourceTurn(delivery)).toBeNull()
  connected = true
  conversation.credentialAccess!.githubInstallationIds = []
  expect(await authorizedResourceTurn(delivery)).toBeNull()
})
test('unlink only updates the authorized conversation', async () => {
  await unlinkSessionResource(actor, resource.id)
  expect(updates).toEqual([
    [{ sessionId: 'session', teamId }, { $pull: { linkedResources: { id: resource.id } } }],
  ])
})
test('input rejects arbitrary URLs and repository path traversal', () => {
  expect(
    sessionResourceInput.safeParse({
      provider: 'github',
      installationId: 12,
      repository: 'org/repo/../../other',
      number: 1,
    }).success,
  ).toBe(false)
  expect(
    sessionResourceInput.safeParse({
      provider: 'github',
      installationId: 12,
      repository: 'org/repo',
      number: 1,
      url: 'https://evil.invalid',
    }).success,
  ).toBe(false)
})
test('unselected credential never gets used', async () => {
  expect(
    await resourceCredentialAllowed(conversation, { provider: 'github', integrationId: '99' }),
  ).toBe(false)
})

test('binding resolves provider-owned identity instead of trusting a caller title or URL', async () => {
  conversation.linkedResources = []
  const linked = await bindSessionResource(actor, {
    provider: 'github',
    installationId: 12,
    repository: 'org/repo',
    number: 56,
  })

  expect(linked).toMatchObject({
    key: 'github/12/34/56',
    title: 'Verified PR',
    url: 'https://github.com/org/repo/pull/56',
  })
  expect(updates).toHaveLength(1)
  expect(lookupCount).toBe(2)
})
test('linking the same verified resource is idempotent', async () => {
  expect(
    await bindSessionResource(actor, {
      provider: 'github',
      installationId: 12,
      repository: 'org/repo',
      number: 56,
    }),
  ).toBe(resource)
  expect(updates).toHaveLength(0)
})
test('unselected installations are rejected before contacting GitHub', async () => {
  await expect(
    bindSessionResource(actor, {
      provider: 'github',
      installationId: 99,
      repository: 'org/repo',
      number: 56,
    }),
  ).rejects.toThrow('Select an accessible integration')
  expect(lookupCount).toBe(0)
})
