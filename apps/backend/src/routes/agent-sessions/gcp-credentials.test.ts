import { expect, test } from 'bun:test'
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
let tokenError: Error | undefined

useModels({
  teamByosBindings: () => ({
    findOne: async () => ({
      gcpServiceAccounts: [
        {
          id: binding,
          projectId: 'project-a',
          serviceAccountEmail: 'gone@project-a.iam.gserviceaccount.com',
          access: { memberAllowList: ['*'] },
        },
      ],
    }),
  }),
})
useAgentSessionsShared({
  getAgentCredentialAccess: async () => ({ gcpServiceAccountIds: [binding.toHexString()] }),
})
useByosGcp({
  impersonateSa: async () => ({
    getAccessToken: async () => {
      if (tokenError) throw tokenError

      return { token: 'fixture-token' }
    },
  }),
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

/** What google-auth-library throws when the connector's service account is gone. */
const impersonationNotFound = () =>
  Object.assign(new Error('NOT_FOUND: unable to impersonate: Requested entity was not found.'), {
    status: 404,
  })

test('a connector service account that is gone is a lasting 409, not a 503 to retry', async () => {
  tokenError = impersonationNotFound()
  const response = await app.request(`/project-a/credentials?serviceAccountId=${binding}`)
  const body = (await response.json()) as { error: { code: string; message: string } }

  expect(response.status).toBe(409)
  expect(body.error.code).toBe('gcp_connector_missing')
  expect(body.error.message).toContain('gone@project-a.iam.gserviceaccount.com')
  expect(body.error.message).toContain('reconnect')
})

test('any other impersonation failure keeps its answer', async () => {
  tokenError = Object.assign(new Error('PERMISSION_DENIED: unable to impersonate: denied'), {
    status: 403,
  })

  expect((await app.request(`/project-a/credentials?serviceAccountId=${binding}`)).status).toBe(503)
})
