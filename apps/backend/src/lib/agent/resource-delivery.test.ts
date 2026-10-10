import { beforeEach, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useByosAccount } from '@/lib/test/doubles/byos-account'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useThreadQueue } from '@/lib/test/doubles/thread-queue'

import { routeResourceWebhook } from './resource-webhook'

import type { ResourceTurn } from './resource-webhook'

let queued: ResourceTurn[] = []
let fail = false
const conversation = {
  sessionId: 'session',
  userId: 'owner',
  teamId: new ObjectId().toHexString(),
  credentialAccess: { githubInstallationIds: ['12'] },
  linkedResources: [
    { id: 'binding', key: 'github/12/34/56', provider: 'github', integrationId: '12' },
  ],
}
const payload = {
  installation: { id: 12 },
  repository: { id: 34 },
  action: 'synchronize',
  pull_request: { number: 56 },
}

useIdentity({ getTeamMembership: async () => ({ role: 'MEMBER' }) })
useByosAccount({ findGithubInstallation: async () => ({ installationId: 12 }) })
useAgentDb({
  agentConversations: () => ({
    find: (filter: unknown) => {
      expect(filter).toEqual({
        'linkedResources.key': 'github/12/34/56',
        archivedAt: { $exists: false },
      })

      return {
        async *[Symbol.asyncIterator]() {
          yield conversation
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
beforeEach(() => {
  queued = []
  fail = false
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
