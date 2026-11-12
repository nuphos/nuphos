import { afterEach, beforeEach, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import type { AgentVars } from './shared'
import type { GcpProjectVariables } from '@/middleware/auth'

import { errorHandler } from '@/lib/errors'
import { useAgentSessionsShared } from '@/lib/test/doubles/agent-sessions-shared'
import { useByosGcp } from '@/lib/test/doubles/byos-gcp'
import { useModels } from '@/lib/test/doubles/models'

const team = new ObjectId()
const binding = new ObjectId()
let selected: string[] = []
let allowList: string[] = ['*']
let purpose: 'permission-admin' | undefined
let calls = 0

useModels({
  teamByosBindings: () => ({
    findOne: async () => ({
      gcpServiceAccounts: [
        {
          id: binding,
          projectId: 'selected-project',
          serviceAccountEmail: 'sa@example.test',
          purpose,
          access: { memberAllowList: allowList },
        },
      ],
    }),
  }),
})
useAgentSessionsShared({
  getAgentCredentialAccess: async () => ({ gcpServiceAccountIds: selected }),
})
useByosGcp({
  impersonateSa: async () => {
    calls++

    return { getAccessToken: async () => ({ token: 'fixture-token' }) }
  },
})

const { projectScoped } = await import('./gcp')
const app = new Hono<{ Variables: AgentVars & GcpProjectVariables }>()

app.onError(errorHandler)
app.use('*', async (c, next) => {
  c.set('teamId', team.toHexString())
  c.set('userId', 'member')
  c.set('agent', { sessionId: 'fixture' } as never)
  await next()
})
app.route('/:projectId', projectScoped)
const realFetch = globalThis.fetch

beforeEach(() => {
  selected = [binding.toHexString()]
  allowList = ['*']
  purpose = undefined
  calls = 0
  globalThis.fetch = (async () =>
    Response.json({
      projectId: 'selected-project',
      projectNumber: '123',
      state: 'ACTIVE',
    })) as unknown as typeof fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
})

test('selected GCP binding can inspect Firebase using the existing credential boundary', async () => {
  const response = await app.request(
    `/selected-project/firebase/project?serviceAccountId=${binding}`,
  )

  expect(response.status).toBe(200)
  expect(calls).toBe(1)
})

test('deselection revokes Firebase access on the next request', async () => {
  selected = []
  expect(
    (await app.request(`/selected-project/firebase/project?serviceAccountId=${binding}`)).status,
  ).toBe(403)
  expect(calls).toBe(0)
})

test('member ACL denial and permission-admin selection fail before minting', async () => {
  allowList = ['another-member']
  expect((await app.request('/selected-project/firebase/apps')).status).toBe(403)
  allowList = ['*']
  purpose = 'permission-admin'
  expect(
    (await app.request(`/selected-project/firebase/apps?serviceAccountId=${binding}`)).status,
  ).toBe(403)
  expect(calls).toBe(0)
})

test('an unbound project or binding never reaches Firebase', async () => {
  expect((await app.request('/another-project/firebase/project')).status).toBe(404)
  expect(
    (await app.request(`/selected-project/firebase/project?serviceAccountId=${new ObjectId()}`))
      .status,
  ).toBe(404)
  expect(calls).toBe(0)
})
