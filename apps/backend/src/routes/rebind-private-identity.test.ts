import { expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { errorHandler } from '@/lib/errors'
import { useByosAccount } from '@/lib/test/doubles/byos-account'
import { useModels } from '@/lib/test/doubles/models'

import { azureAccountsRoutes } from './azure-accounts'
import { gcpProjectsRoutes } from './gcp-projects'

import type { TeamAuthVariables } from '@/middleware/auth'

const access = {
  memberAllowList: ['owner'],
  ownerUserId: 'owner',
  updatedAt: new Date(),
  updatedBy: 'owner',
}
const tenantId = '11111111-1111-1111-1111-111111111111'
const clientId = '22222222-2222-2222-2222-222222222222'

useByosAccount({ listGcpBindingsForProject: async () => [] })
useModels({
  teamByosBindings: () =>
    ({
      findOne: async () => ({
        gcpServiceAccounts: [
          {
            id: new ObjectId(),
            serviceAccountEmail: 'sa@p.iam.gserviceaccount.com',
            projectId: 'p',
            access,
          },
        ],
        azureAccounts: [
          { id: new ObjectId(), tenantId, clientId, subscriptionId: 'x', label: 'a', access },
        ],
      }),
    }) as never,
})

function post(routes: Hono<{ Variables: TeamAuthVariables }>, body: unknown) {
  const app = new Hono<{ Variables: TeamAuthVariables }>()

  app.use('*', async (c, next) => {
    c.set('teamId', new ObjectId().toHexString())
    c.set('userId', 'admin')
    c.set('teamRole', 'ADMINISTRATOR')
    await next()
  })
  app.route('/', routes)

  return app.onError(errorHandler).request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test("an admin cannot bind another member's private GCP service account under another project", async () => {
  const response = await post(gcpProjectsRoutes, {
    serviceAccountEmail: 'sa@p.iam.gserviceaccount.com',
    projectId: 'other',
  })

  expect(response.status).toBe(403)
})

test("an admin cannot bind another member's private Azure app under another subscription", async () => {
  const response = await post(azureAccountsRoutes, {
    label: 'mine',
    tenantId,
    clientId,
    subscriptionId: '33333333-3333-3333-3333-333333333333',
  })

  expect(response.status).toBe(403)
})
