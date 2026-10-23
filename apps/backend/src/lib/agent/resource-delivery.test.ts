import { beforeEach, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useByosAccount } from '@/lib/test/doubles/byos-account'
import { useByosGithub } from '@/lib/test/doubles/byos-github'
import { useGithubHttp } from '@/lib/test/doubles/github-http'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useThreadQueue } from '@/lib/test/doubles/thread-queue'

import { routeResourceWebhook } from './resource-webhook'

import type { ResourceTurn } from './resource-webhook'

let queued: ResourceTurn[] = []
let fail = false
let lookups: string[] = []
let permission: { status: number; permission?: string } = { status: 200, permission: 'write' }
let repoLinked = true

type CommitPull = { number: number; state: string; head: { sha: string } }
const openPull: CommitPull = { number: 56, state: 'open', head: { sha: 'a'.repeat(40) } }
let commitPulls: { status: number; pulls: CommitPull[] } = { status: 200, pulls: [openPull] }
const conversation = {
  sessionId: 'session',
  userId: 'owner',
  teamId: new ObjectId().toHexString(),
  credentialAccess: { githubInstallationIds: ['12'] },
  linkedResources: [
    { id: 'binding', key: 'github/12/34/56', provider: 'github', integrationId: '12' },
  ],
}
let conversations = [conversation]
const payload = {
  installation: { id: 12 },
  repository: { id: 34, full_name: 'acme/app' },
  action: 'synchronize',
  pull_request: { number: 56 },
}

useIdentity({ getTeamMembership: async () => ({ role: 'MEMBER' }) })
useByosAccount({ findGithubInstallation: async () => ({ installationId: 12 }) })
useAgentDb({
  agentConversations: () => ({
    findOne: async (filter: unknown) => {
      expect(filter).toEqual({
        'linkedResources.key': { $regex: '^github/12/34/' },
      })

      return repoLinked ? conversation : null
    },
    find: (filter: unknown) => {
      expect(filter).toEqual({
        'linkedResources.key': 'github/12/34/56',
      })

      return {
        async *[Symbol.asyncIterator]() {
          yield* conversations
        },
      }
    },
  }),
})
useThreadQueue({
  enqueueResourceTurn: async (data) => {
    if (fail) throw new Error('queue unavailable')
    queued.push(data)
  },
})
useByosGithub({ getInstallationToken: async () => ({ token: 'token', expiresAt: new Date() }) })
useGithubHttp({
  githubFetch: async (url) => {
    lookups.push(url)
    if (url.endsWith('/pulls'))
      return Response.json(commitPulls.pulls, { status: commitPulls.status })

    return Response.json({ permission: permission.permission }, { status: permission.status })
  },
})
beforeEach(() => {
  queued = []
  fail = false
  lookups = []
  permission = { status: 200, permission: 'write' }
  conversations = [conversation]
  repoLinked = true
  commitPulls = { status: 200, pulls: [openPull] }
})

test('redelivery has the same durable job identity while a new delivery is distinct', async () => {
  await routeResourceWebhook('pull_request', payload, 'delivery-1')
  await routeResourceWebhook('pull_request', payload, 'delivery-1')
  await routeResourceWebhook('pull_request', payload, 'delivery-2')
  expect(queued).toHaveLength(3)
  expect(queued[0]?.messageId).toBe(queued[1]?.messageId)
  expect(queued[0]?.messageId).not.toBe(queued[2]?.messageId)
})
test('queue failure is not acknowledged as delivery', async () => {
  fail = true
  await expect(routeResourceWebhook('pull_request', payload, 'delivery')).rejects.toThrow(
    'queue unavailable',
  )
})
test('missing delivery IDs cannot route a matching event', async () => {
  await expect(routeResourceWebhook('pull_request', payload, '')).rejects.toThrow('delivery ID')
  expect(queued).toHaveLength(0)
})

const review = {
  installation: { id: 12 },
  repository: { id: 34, full_name: 'acme/app' },
  action: 'submitted',
  sender: { type: 'User', login: 'octo cat' },
  pull_request: { number: 56 },
}

test('reviewers who cannot push, or whose permission is unknown, do not wake a session', async () => {
  for (const denied of [
    { status: 200, permission: 'read' },
    { status: 200, permission: 'none' },
    { status: 404 },
    { status: 502 },
  ]) {
    permission = denied
    await routeResourceWebhook('pull_request_review', review, 'delivery')
  }
  expect(queued).toHaveLength(0)
  expect(lookups[0]).toBe(
    'https://api.github.com/repos/acme/app/collaborators/octo%20cat/permission',
  )
})
test('reviewers with write or admin wake a session', async () => {
  for (const allowed of ['write', 'admin']) {
    permission = { status: 200, permission: allowed }
    await routeResourceWebhook('pull_request_review', review, `delivery-${allowed}`)
  }
  expect(queued).toHaveLength(2)
})
test('one delivery looks up the sender once across every linked conversation', async () => {
  conversations = [conversation, { ...conversation, sessionId: 'other' }]
  await routeResourceWebhook('pull_request_review', review, 'delivery')
  expect(lookups).toHaveLength(1)
  expect(queued.map((turn) => turn.sessionId)).toEqual(['session', 'other'])
})
test('pushes and CI results do not need a permission lookup', async () => {
  await routeResourceWebhook('pull_request', payload, 'delivery')
  expect(lookups).toHaveLength(0)
  expect(queued).toHaveLength(1)
})

const sha = 'a'.repeat(40)
const status = {
  installation: { id: 12 },
  repository: { id: 34, full_name: 'acme/app' },
  sha,
  state: 'failure',
  context: 'openab/council',
  sender: { type: 'Bot', login: 'opencodezebra[bot]' },
}

test('a finished commit status wakes the linked PR that holds the commit', async () => {
  await routeResourceWebhook('status', status, 'delivery')
  expect(lookups).toEqual([`https://api.github.com/repos/acme/app/commits/${sha}/pulls`])
  expect(queued).toHaveLength(1)
  expect(queued[0]?.summary).toContain('status.failure (openab/council)')
})
test('statuses ask GitHub nothing unless the repository has a linked PR', async () => {
  repoLinked = false
  await routeResourceWebhook('status', status, 'delivery')
  expect(lookups).toHaveLength(0)
  expect(queued).toHaveLength(0)
})
test('a failed commit-to-PR lookup wakes nobody', async () => {
  commitPulls = { status: 502, pulls: [] }
  await routeResourceWebhook('status', status, 'delivery')
  expect(queued).toHaveLength(0)
})
test('bot reviews wake without a permission lookup', async () => {
  await routeResourceWebhook(
    'pull_request_review',
    { ...review, sender: { type: 'Bot', login: 'opencodezebra[bot]' } },
    'delivery',
  )
  expect(lookups).toHaveLength(0)
  expect(queued).toHaveLength(1)
})
test('statuses do not wake merged PRs or PRs whose head moved past the commit', async () => {
  commitPulls = {
    status: 200,
    pulls: [
      { number: 56, state: 'closed', head: { sha } },
      { number: 56, state: 'open', head: { sha: 'b'.repeat(40) } },
    ],
  }
  await routeResourceWebhook('status', status, 'delivery')
  expect(queued).toHaveLength(0)
})
