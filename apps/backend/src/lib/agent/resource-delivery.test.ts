import { beforeEach, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useByosAccount } from '@/lib/test/doubles/byos-account'
import { useByosGithub } from '@/lib/test/doubles/byos-github'
import { useGithubHttp } from '@/lib/test/doubles/github-http'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useRedis } from '@/lib/test/doubles/redis'
import { useThreadQueue } from '@/lib/test/doubles/thread-queue'

import { authorizedResourceTurn, routeResourceWebhook } from './resource-webhook'

import type { ResourceTurn } from './resource-webhook'

let queued: ResourceTurn[] = []
let fail = false
let lookups: string[] = []
let permission: { status: number; permission?: string } = { status: 200, permission: 'write' }
let wakes: number | null = 1
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
  getConversationBySessionId: async () => conversation as never,
  agentConversations: () => ({
    find: (filter: unknown) => {
      expect(filter).toEqual({
        'linkedResources.key': 'github/12/34/56',
        archivedAt: { $exists: false },
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

    return Response.json({ permission: permission.permission }, { status: permission.status })
  },
})
beforeEach(() => {
  queued = []
  fail = false
  lookups = []
  permission = { status: 200, permission: 'write' }
  conversations = [conversation]
  wakes = 1
})
useRedis({ withRedis: async () => wakes as never })

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

const turn = { sessionId: 'session', resourceId: 'binding', messageId: 'm', summary: 's' }

test('a binding wakes at most six times an hour', async () => {
  for (const count of [1, 6]) {
    wakes = count
    expect(await authorizedResourceTurn(turn)).not.toBeNull()
  }
  wakes = 7
  expect(await authorizedResourceTurn(turn)).toBeNull()
})
test('an unavailable wake counter does not swallow a wakeup', async () => {
  wakes = null
  expect(await authorizedResourceTurn(turn)).not.toBeNull()
})
