import { beforeEach, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { invalidateInstallationToken } from '@/lib/byos/github'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useByosAccount } from '@/lib/test/doubles/byos-account'
import { useGithubAppAuth } from '@/lib/test/doubles/github-app-auth'
import { useGithubHttp } from '@/lib/test/doubles/github-http'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useObservability } from '@/lib/test/doubles/observability'

import {
  MAX_RUNNING_RECHECKS,
  RECHECK_INTERVAL_MS,
  recheckLinkedResources,
} from './resource-recheck'

import type { AgentConversation } from './db'
import type { SessionResource } from './session-resources'

const teamId = new ObjectId().toHexString()
const now = Date.parse('2026-10-29T12:00:00Z')
const pull = (id: string, overrides: Partial<SessionResource> = {}): SessionResource => ({
  id,
  key: `github/12/34/${id}`,
  provider: 'github',
  integrationId: '12',
  resourceId: '34/56',
  repository: 'org/repo',
  number: 56,
  title: 'PR',
  state: 'open',
  url: 'https://github.com/org/repo/pull/56',
  linkedAt: new Date(now - 86_400_000).toISOString(),
  ...overrides,
})
let conversation: AgentConversation
let claims: unknown[] = []
let refreshes: unknown[] = []
let claimWins = true
let pullStatus = 200
let pullFetches = 0
let warnings: string[] = []

useIdentity({ getTeamMembership: () => Promise.resolve({ role: 'MEMBER' }) })
useByosAccount({ findGithubInstallation: () => Promise.resolve({ installationId: 12 }) })
useObservability({
  logEvent: (_level, event) => {
    warnings.push(event)
  },
})
useAgentDb({
  getConversationBySessionId: () => Promise.resolve(conversation),
  agentConversations: () => ({
    updateOne: (filter: Record<string, unknown>, update: Record<string, unknown>) => {
      if ('linkedResources' in filter) {
        claims.push([filter, update])

        return Promise.resolve({ modifiedCount: claimWins ? 1 : 0 })
      }
      refreshes.push([filter, update])

      return Promise.resolve({ modifiedCount: 1 })
    },
  }),
})
useGithubAppAuth({ generateAppJwt: () => 'test-jwt' })
useGithubHttp({
  githubFetch: (url) => Promise.resolve(githubResponse(url)),
})
function githubResponse(url: string) {
  if (url.includes('/access_tokens'))
    return Response.json({ token: 'test-token', expires_at: '2099-01-01T00:00:00Z' })
  if (url.includes('/check-runs')) return Response.json({ check_runs: [] })
  if (url.endsWith('/status')) return Response.json({ state: 'success', total_count: 0 })
  if (url.includes('/reviews')) return Response.json([])
  pullFetches++
  if (pullStatus !== 200) return new Response('{}', { status: pullStatus })

  return Response.json({
    number: 56,
    title: 'PR',
    state: 'closed',
    merged: true,
    head: { sha: 'a'.repeat(40) },
    base: { repo: { id: 34, full_name: 'org/repo' } },
  })
}
beforeEach(() => {
  invalidateInstallationToken(12)
  claims = []
  refreshes = []
  warnings = []
  claimWins = true
  pullStatus = 200
  pullFetches = 0
  conversation = {
    sessionId: 'session',
    userId: 'owner',
    teamId,
    generalAccess: 'none',
    linkedResources: [pull('a')],
    credentialAccess: { githubInstallationIds: ['12'] },
  } as AgentConversation
})

test('an open PR never checked is claimed, then refreshed with what GitHub says now', async () => {
  await recheckLinkedResources(conversation, now)

  expect(claims).toEqual([
    [
      {
        sessionId: 'session',
        linkedResources: {
          $elemMatch: {
            id: 'a',
            $or: [
              { checkedAt: { $exists: false } },
              { checkedAt: { $lte: new Date(now - RECHECK_INTERVAL_MS).toISOString() } },
            ],
          },
        },
      },
      { $set: { 'linkedResources.$.checkedAt': new Date(now).toISOString() } },
    ],
  ])
  expect(refreshes).toHaveLength(1)
  expect(refreshes[0]).toMatchObject([
    { sessionId: 'session', 'linkedResources.id': 'a' },
    { $set: { 'linkedResources.$.state': 'merged' } },
  ])
})
test('a resource checked within the interval is left alone', async () => {
  conversation.linkedResources = [
    pull('a', { checkedAt: new Date(now - RECHECK_INTERVAL_MS + 1000).toISOString() }),
  ]
  await recheckLinkedResources(conversation, now)
  expect(claims).toEqual([])
  expect(pullFetches).toBe(0)
})
test('a resource is checked again once the interval has passed', async () => {
  conversation.linkedResources = [
    pull('a', { checkedAt: new Date(now - RECHECK_INTERVAL_MS).toISOString() }),
  ]
  await recheckLinkedResources(conversation, now)
  expect(claims).toHaveLength(1)
  expect(pullFetches).toBe(1)
})
test('a check another reader already claimed is not repeated', async () => {
  claimWins = false
  await recheckLinkedResources(conversation, now)
  expect(claims).toHaveLength(1)
  expect(pullFetches).toBe(0)
  expect(refreshes).toEqual([])
})
test('finished resources are never checked again', async () => {
  conversation.linkedResources = [
    pull('merged', { state: 'merged' }),
    pull('closed', { state: 'closed' }),
    {
      ...pull('done'),
      provider: 'linear',
      integrationId: new ObjectId().toHexString(),
      state: 'Done',
      stateType: 'completed',
    },
    {
      ...pull('dropped'),
      provider: 'linear',
      integrationId: new ObjectId().toHexString(),
      state: 'Canceled',
      stateType: 'canceled',
    },
  ]
  await recheckLinkedResources(conversation, now)
  expect(claims).toEqual([])
  expect(pullFetches).toBe(0)
})
test('an archived conversation is not checked', async () => {
  conversation.archivedAt = new Date(now)
  await recheckLinkedResources(conversation, now)
  expect(claims).toEqual([])
  expect(pullFetches).toBe(0)
})
test('a deselected installation is not contacted', async () => {
  conversation.credentialAccess!.githubInstallationIds = []
  await recheckLinkedResources(conversation, now)
  expect(claims).toHaveLength(1)
  expect(pullFetches).toBe(0)
  expect(warnings).toEqual([])
})
test('a failed lookup is logged and does not reach the caller', async () => {
  pullStatus = 404
  await recheckLinkedResources(conversation, now)
  expect(pullFetches).toBe(1)
  expect(refreshes).toEqual([])
  expect(warnings).toEqual(['linked_resource.recheck_failed'])
})
test('only a few checks run at once', async () => {
  conversation.linkedResources = Array.from({ length: MAX_RUNNING_RECHECKS + 2 }, (_, index) =>
    pull(String(index)),
  )
  await recheckLinkedResources(conversation, now)
  expect(claims).toHaveLength(MAX_RUNNING_RECHECKS)
})
