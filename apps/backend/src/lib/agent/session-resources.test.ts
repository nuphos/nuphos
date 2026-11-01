import { beforeEach, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { invalidateInstallationToken } from '@/lib/byos/github'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useByosAccount } from '@/lib/test/doubles/byos-account'
import { useGithubAppAuth } from '@/lib/test/doubles/github-app-auth'
import { useGithubHttp } from '@/lib/test/doubles/github-http'
import { useIdentity } from '@/lib/test/doubles/identity'

import { authorizedResourceTurn } from './resource-webhook'
import { resourceCredentialAllowed } from './session-resource-lookup'
import {
  bindSessionResource,
  resourceConversation,
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
let merged = false
let draft = false

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

    if (url.includes('/check-runs'))
      return Response.json({ check_runs: [{ conclusion: 'success' }, { conclusion: 'failure' }] })
    if (url.endsWith('/status')) return Response.json({ state: 'success', total_count: 1 })
    if (url.includes('/reviews')) return Response.json([])

    return Response.json({
      number: 56,
      title: 'Verified PR',
      state: merged ? 'closed' : 'open',
      merged,
      draft,
      merged_at: merged ? '2026-10-29T03:12:00Z' : null,
      mergeable_state: 'clean',
      head: { sha: 'a'.repeat(40) },
      base: { repo: { id: 34, full_name: 'org/repo' } },
    })
  },
})
beforeEach(() => {
  invalidateInstallationToken(12)
  lookupCount = 0
  merged = false
  draft = false
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
test('worker rechecks unlink, membership, selection and disconnected integrations', async () => {
  expect(await authorizedResourceTurn(delivery)).not.toBeNull()
  // An archived conversation still wakes; its turn restores it.
  conversation.archivedAt = new Date()
  expect(await authorizedResourceTurn(delivery)).not.toBeNull()
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
test('reply-only participants cannot unlink the conversation thread', async () => {
  conversation.participantIds = ['participant']
  await expect(
    unlinkSessionResource({ ...actor, userId: 'participant' }, 'slack:C1:1.2'),
  ).rejects.toThrow('owner or manager')
  expect(updates).toEqual([])
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
    // A failed check run on the head commit: the tag starts red.
    health: 'checks_failed',
  })
  expect(updates).toHaveLength(1)
  // The token and the PR, then its check runs, status and reviews (the PR is not fetched twice).
  expect(lookupCount).toBe(5)
})
test('linking an already linked resource refreshes it in place', async () => {
  const linked = await bindSessionResource(actor, {
    provider: 'github',
    installationId: 12,
    repository: 'org/repo',
    number: 56,
  })

  expect(linked).toMatchObject({
    id: resource.id,
    key: resource.key,
    linkedAt: resource.linkedAt,
    title: 'Verified PR',
    state: 'open',
    health: 'checks_failed',
  })
  // One positional update of the existing entry, never a second push.
  expect(updates).toEqual([
    [
      { sessionId: 'session', 'linkedResources.id': resource.id },
      {
        $set: {
          'linkedResources.$.title': 'Verified PR',
          'linkedResources.$.state': 'open',
          'linkedResources.$.url': 'https://github.com/org/repo/pull/56',
          'linkedResources.$.health': 'checks_failed',
          'linkedResources.$.draft': false,
        },
      },
    ],
  ])
})
test('linking again records a merge that no webhook delivered', async () => {
  merged = true
  const linked = await bindSessionResource(actor, {
    provider: 'github',
    installationId: 12,
    repository: 'org/repo',
    number: 56,
  })

  expect(linked.state).toBe('merged')
  expect(linked.mergedAt).toBe('2026-10-29T03:12:00Z')
  expect(updates).toHaveLength(1)
  expect(updates[0]).toMatchObject([
    {},
    {
      $set: {
        'linkedResources.$.state': 'merged',
        'linkedResources.$.mergedAt': '2026-10-29T03:12:00Z',
      },
    },
  ])
})
test('linking again records that the PR is a draft', async () => {
  draft = true
  const linked = await bindSessionResource(actor, {
    provider: 'github',
    installationId: 12,
    repository: 'org/repo',
    number: 56,
  })

  expect(linked).toMatchObject({ state: 'open', draft: true })
  expect(updates[0]).toMatchObject([{}, { $set: { 'linkedResources.$.draft': true } }])
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
