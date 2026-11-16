import { expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { errorHandler } from '@/lib/errors'
import { useByosAccount } from '@/lib/test/doubles/byos-account'
import { useModels } from '@/lib/test/doubles/models'

import { awsAccountsRoutes } from './aws-accounts'
import { azureAccountsRoutes } from './azure-accounts'
import { gcpProjectsRoutes } from './gcp-projects'
import { tencentAccountsRoutes } from './tencent-accounts'

import type { TeamAuthVariables } from '@/middleware/auth'

const access = {
  memberAllowList: ['owner'],
  ownerUserId: 'owner',
  updatedAt: new Date(),
  updatedBy: 'owner',
}
const tenantId = 'aaaaaaaa-1111-1111-1111-111111111111'
const clientId = 'bbbbbbbb-2222-2222-2222-222222222222'

useByosAccount({
  listGcpBindingsForProject: async () => [],
  findAwsBindingByRoleArn: async () => null,
})
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
        awsRoles: [
          { id: new ObjectId(), roleArn: 'arn:aws:iam::123456789012:role/Deploy', access },
        ],
        tencentAccounts: [
          { id: new ObjectId(), roleArn: 'qcs::cam::uin/100001:roleName/Nuphos', access },
          { id: new ObjectId(), roleArn: 'qcs::cam::uin/200002:role/4611686018427387905', access },
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

test('a different spelling of the same Azure app is the same app', async () => {
  const response = await post(azureAccountsRoutes, {
    label: 'mine',
    tenantId: tenantId.toUpperCase(),
    clientId: clientId.toUpperCase(),
    subscriptionId: '33333333-3333-3333-3333-333333333333',
  })

  expect(response.status).toBe(403)
})

test("an admin cannot bind another member's private AWS role spelled in another case", async () => {
  const response = await post(awsAccountsRoutes, {
    roleArn: 'arn:aws:iam::123456789012:role/deploy',
  })

  expect(response.status).toBe(403)
})

test("an admin cannot bind another member's private Tencent role spelled in another case", async () => {
  const response = await post(tencentAccountsRoutes, {
    label: 'mine',
    roleArn: 'qcs::cam::uin/100001:roleName/NUPHOS',
    providerId: 'nuphos',
  })

  expect(response.status).toBe(403)
})

test('a Tencent role is bound by its roleName form only', async () => {
  const response = await post(tencentAccountsRoutes, {
    label: 'mine',
    roleArn: 'qcs::cam::uin/100001:role/4611686018427387904',
    providerId: 'nuphos',
  })

  expect(response.status).toBe(400)
})

test("a role can't be bound by name in an account where someone holds one privately by id", async () => {
  const response = await post(tencentAccountsRoutes, {
    label: 'mine',
    roleArn: 'qcs::cam::uin/200002:roleName/Anything',
    providerId: 'nuphos',
  })

  expect(response.status).toBe(403)
  expect(((await response.json()) as { error: { message: string } }).error.message).toContain(
    'Ask them to share it',
  )
})
