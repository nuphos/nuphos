import { beforeEach, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { invalidateInstallationToken } from '@/lib/byos/github'
import { sessionResourceToolModule } from '@/lib/claude-code-preview/preview-tools/session-resources'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useByosAccount } from '@/lib/test/doubles/byos-account'
import { useConversationTurn } from '@/lib/test/doubles/conversation-turn'
import { useGithubAppAuth } from '@/lib/test/doubles/github-app-auth'
import { useGithubHttp } from '@/lib/test/doubles/github-http'
import { useIdentity } from '@/lib/test/doubles/identity'

import { executeResourceTurn } from './resource-turn'
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
/** What GitHub answers for the pull request itself, when a test overrides it. */
let pullFailure: Response | undefined
let turns: unknown[][] = []

useIdentity({ getTeamMembership: async () => (membership ? { role: 'MEMBER' } : null) })
useByosAccount({
  findGithubInstallation: async () => (connected ? { installationId: 12 } : null),
})
useAgentDb({
  getConversationBySessionId: async () => conversation,
  agentConversations: () => ({
    updateOne: async (...args: unknown[]) => {
      updates.push(args)
      const update = args[1] as { $pull?: { linkedResources?: { id: string } } }
      const removedId = update.$pull?.linkedResources?.id

      if (removedId)
        conversation.linkedResources = conversation.linkedResources?.filter(
          (entry) => entry.id !== removedId,
        )

      return { modifiedCount: 1 }
    },
  }),
})
useConversationTurn({
  executeConversationTurn: async (...args: unknown[]) => {
    turns.push(args)
  },
})
useGithubAppAuth({ generateAppJwt: () => 'test-jwt' })
useGithubHttp({
  githubFetch: async (url) => {
    lookupCount++
    if (url.includes('/access_tokens'))
      return Response.json({ token: 'test-token', expires_at: '2099-01-01T00:00:00Z' })

    if (url.includes('/check-runs'))
      return Response.json({
        check_runs: [
          { id: 1, name: 'build', conclusion: 'success' },
          { id: 2, name: 'test', conclusion: 'failure' },
        ],
      })
    if (url.endsWith('/status')) return Response.json({ state: 'success', total_count: 1 })
    if (url.includes('/reviews')) return Response.json([])
    if (url.endsWith('/pulls/78')) return new Response('Not Found', { status: 404 })
    if (url.endsWith('/issues/78'))
      return Response.json({ number: 78, title: 'Verified issue', state: 'open' })
    if (url.endsWith('/repos/org/repo')) return Response.json({ id: 34, full_name: 'org/repo' })
    if (pullFailure) return pullFailure

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
  pullFailure = undefined
  turns = []
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
test('participants cannot enable autonomous wakeups', async () => {
  conversation.participantIds = ['participant']
  await expect(resourceConversation({ ...actor, userId: 'participant' }, true)).rejects.toThrow(
    'owner',
  )
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
test('participants cannot unlink the conversation thread', async () => {
  conversation.participantIds = ['participant']
  await expect(
    unlinkSessionResource({ ...actor, userId: 'participant' }, 'slack:C1:1.2'),
  ).rejects.toThrow('owner')
  expect(updates).toEqual([])
})
test('unlink only updates the authorized conversation', async () => {
  await unlinkSessionResource(actor, resource.id)
  expect(updates).toEqual([
    [{ sessionId: 'session', teamId }, { $pull: { linkedResources: { id: resource.id } } }],
  ])
})
test('unlink by resource key removes only the matching binding', async () => {
  const other = { ...resource, id: 'other-id', key: 'github/12/34/99' }

  conversation.linkedResources = [resource, other]
  await unlinkSessionResource(actor, resource.key)
  expect((await resourceConversation(actor)).linkedResources).toEqual([other])
})
test('MCP unlinks a resource using the listed key', async () => {
  const tools = sessionResourceToolModule().handlers(actor as never)
  const result = (await tools.unlink_session_resource!({
    label: 'Unlink PR',
    resourceId: resource.key,
  })) as { isError?: boolean; content: { text: string }[] }

  expect(result.isError).not.toBe(true)
  expect((await resourceConversation(actor)).linkedResources).toEqual([])
  expect(await authorizedResourceTurn(delivery)).toBeNull()
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
test('a GitHub issue links as an issue, with no pull request health', async () => {
  conversation.linkedResources = []
  const linked = await bindSessionResource(actor, {
    provider: 'github',
    installationId: 12,
    repository: 'org/repo',
    number: 78,
  })

  expect(linked).toMatchObject({
    key: 'github/12/34/78',
    kind: 'issue',
    title: 'Verified issue',
    state: 'open',
    url: 'https://github.com/org/repo/issues/78',
  })
  expect(linked).not.toHaveProperty('health')
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

const pullInput = {
  provider: 'github',
  installationId: 12,
  repository: 'org/repo',
  number: 56,
} as const
// A reset at 11:41 UTC.
const resetAt = '1795002060'

test('a spent GitHub quota names the reset time instead of a bare status', async () => {
  pullFailure = new Response('{"message":"API rate limit exceeded"}', {
    status: 403,
    headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': resetAt },
  })
  await expect(bindSessionResource(actor, pullInput)).rejects.toMatchObject({
    status: 429,
    code: 'github_rate_limited',
    message: expect.stringContaining('retry after 11:41 UTC'),
  })
})
test('a secondary GitHub rate limit names the wait it asks for', async () => {
  pullFailure = new Response('{}', { status: 403, headers: { 'retry-after': '60' } })
  await expect(bindSessionResource(actor, pullInput)).rejects.toMatchObject({
    code: 'github_rate_limited',
    message: expect.stringContaining('retry after 60 seconds'),
  })
})
test('a GitHub denial with quota left names the repository the installation cannot read', async () => {
  pullFailure = new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '42' } })
  await expect(bindSessionResource(actor, pullInput)).rejects.toMatchObject({
    status: 403,
    message: expect.stringContaining('no access to org/repo'),
  })
  pullFailure = new Response('{}', { status: 404 })
  await expect(bindSessionResource(actor, pullInput)).rejects.toMatchObject({
    status: 404,
    message: expect.stringContaining('org/repo#56'),
  })
})
test('the bind tool returns the lookup failure to the agent, not an internal error', async () => {
  pullFailure = new Response('{}', {
    status: 403,
    headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': resetAt },
  })
  const tools = sessionResourceToolModule().handlers(actor as never)
  const result = (await tools.bind_session_resource!({
    label: 'Link PR',
    resource: pullInput,
  })) as {
    isError?: boolean
    content: { text: string }[]
  }

  expect(result.isError).toBe(true)
  expect(result.content[0]!.text).toContain('retry after 11:41 UTC')
})
test('a GitHub event still wakes the conversation when GitHub cannot be read', async () => {
  pullFailure = new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0' } })
  await executeResourceTurn(delivery)

  expect(turns).toHaveLength(1)
  // The webhook already stored what changed; the wakeup reads nothing more from GitHub.
  expect(lookupCount).toBe(0)
})
