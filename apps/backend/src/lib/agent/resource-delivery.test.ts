import { beforeEach, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useByosAccount } from '@/lib/test/doubles/byos-account'
import { useByosGithub } from '@/lib/test/doubles/byos-github'
import { useGithubHttp } from '@/lib/test/doubles/github-http'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useRedis } from '@/lib/test/doubles/redis'
import { useThreadQueue } from '@/lib/test/doubles/thread-queue'

import { resetWakeSlots, routeResourceWebhook, takeWakeSlot } from './resource-webhook'

import type { ResourceTurn } from './resource-webhook'

let queued: ResourceTurn[] = []
let fail = false
let lookups: string[] = []
let permission: { status: number; permission?: string } = { status: 200, permission: 'write' }
let wakes: number | null = 1
let redisOps: string[] = []

type Suite = { id: number; status: string; latest_check_runs_count: number }
let suites: Suite[] = []
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
  getConversationBySessionId: async () => conversation,
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
    if (url.includes('/check-suites')) return Response.json({ check_suites: suites })

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
  redisOps = []
  suites = []
})
useRedis({
  withRedis: async (op) => {
    const ops: string[] = []

    await op({ del: async () => ops.push('del') } as never).catch(() => {})
    redisOps.push(...ops)

    return wakes
  },
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

const turn = { sessionId: 'session', resourceId: 'binding', messageId: 'm', summary: 's' }

test('CI stops waking a binding after ten unattended wakes in a row', async () => {
  for (const count of [1, 10]) {
    wakes = count
    expect(await takeWakeSlot(turn)).toBe(true)
  }
  wakes = 11
  expect(await takeWakeSlot(turn)).toBe(false)
})
test('an unavailable or unreadable wake counter does not swallow a wakeup', async () => {
  for (const count of [null, Number.NaN]) {
    wakes = count
    expect(await takeWakeSlot(turn)).toBe(true)
  }
})
test('reviews are marked as coming from a person, pushes are not', async () => {
  await routeResourceWebhook('pull_request_review', review, 'delivery-review')
  await routeResourceWebhook('pull_request', payload, 'delivery-push')
  expect(queued.map((queuedTurn) => queuedTurn.fromPerson)).toEqual([true, false])
})
test('a person re-arms CI wakes for the binding', async () => {
  await resetWakeSlots(turn)
  expect(redisOps).toEqual(['del'])
})

const ci = {
  installation: { id: 12 },
  repository: { id: 34, full_name: 'acme/app' },
  action: 'completed',
  sender: { type: 'Bot', login: 'nuphos[bot]' },
  check_suite: {
    head_sha: 'a'.repeat(40),
    status: 'completed',
    conclusion: 'success',
    pull_requests: [{ number: 56 }],
  },
}

test('CI wakes once per commit, only after every suite with check runs finished', async () => {
  suites = [
    { id: 1, status: 'completed', latest_check_runs_count: 1 },
    { id: 2, status: 'in_progress', latest_check_runs_count: 3 },
    // An App with checks permission that never reports: queued forever, no runs.
    { id: 3, status: 'queued', latest_check_runs_count: 0 },
  ]
  await routeResourceWebhook('check_suite', ci, 'suite-1')
  expect(queued).toHaveLength(0)
  expect(lookups[0]).toBe(
    `https://api.github.com/repos/acme/app/commits/${'a'.repeat(40)}/check-suites?per_page=100`,
  )

  suites[1] = { id: 2, status: 'completed', latest_check_runs_count: 3 }
  // Both suites' completions can observe the finished set; they share one job identity.
  await routeResourceWebhook('check_suite', ci, 'suite-2')
  await routeResourceWebhook('check_suite', ci, 'suite-1-retry')
  expect(queued).toHaveLength(2)
  expect(queued[0]?.messageId).toBe(queued[1]?.messageId)
  expect(queued[0]?.fromPerson).toBe(false)
})
test('a suite that appears later still wakes the session for its result', async () => {
  suites = [{ id: 1, status: 'completed', latest_check_runs_count: 1 }]
  await routeResourceWebhook('check_suite', ci, 'suite-1')
  suites.push({ id: 4, status: 'completed', latest_check_runs_count: 2 })
  await routeResourceWebhook('check_suite', ci, 'suite-4')
  expect(queued[0]?.messageId).not.toBe(queued[1]?.messageId)
})
