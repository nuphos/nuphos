import { expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { errorHandler } from '@/lib/errors'
import { useByosAccount } from '@/lib/test/doubles/byos-account'

import {
  requireAwsAccount,
  requireAwsMemberAccess,
  requireGcpMemberAccess,
  requireGcpProject,
} from './cloud'

import type { AwsAccountVariables, GcpProjectVariables } from './types'

const list = (memberAllowList: string[]) => ({
  memberAllowList,
  ownerUserId: 'owner',
  updatedAt: new Date(),
  updatedBy: 'owner',
})
// The first binding is the owner's private one; the second is shared with someone else.
const privateId = new ObjectId()
const sharedId = new ObjectId()
const accessOf = [list(['owner']), list(['owner', 'teammate'])]

useByosAccount({
  listAwsBindingsForAccount: async () =>
    [privateId, sharedId].map((id, i) => ({
      id,
      roleArn: `arn:aws:iam::123456789012:role/r${String(i)}`,
      access: accessOf[i],
    })),
  listGcpBindingsForProject: async () =>
    [privateId, sharedId].map((id, i) => ({
      id,
      serviceAccountEmail: `sa${String(i)}@p.iam.gserviceaccount.com`,
      access: accessOf[i],
    })),
})

type Role = 'ADMINISTRATOR' | 'EDITOR'

function app(userId: string, teamRole: Role) {
  const root = new Hono<{ Variables: AwsAccountVariables & GcpProjectVariables }>()

  root.use('*', async (c, next) => {
    c.set('teamId', new ObjectId().toHexString())
    c.set('userId', userId)
    c.set('teamRole', teamRole)
    await next()
  })
  root.get('/aws/:accountId', requireAwsAccount(), requireAwsMemberAccess(), (c) =>
    c.json({ id: c.get('awsBinding').id.toHexString() }),
  )
  root.get('/gcp/:projectId', requireGcpProject(), requireGcpMemberAccess(), (c) =>
    c.json({ id: c.get('gcpBinding').id.toHexString() }),
  )

  return root.onError(errorHandler)
}

const picked = async (path: string, userId: string, teamRole: Role) => {
  const response = await app(userId, teamRole).request(path)

  return response.status === 200 ? ((await response.json()) as { id: string }).id : response.status
}

test('without a named role, an admin gets the shared AWS binding, not a 403 from the private one', async () => {
  expect(await picked('/aws/123456789012', 'admin', 'ADMINISTRATOR')).toBe(sharedId.toHexString())
  expect(await picked('/aws/123456789012', 'owner', 'EDITOR')).toBe(privateId.toHexString())
  expect(await picked('/aws/123456789012', 'stranger', 'EDITOR')).toBe(403)
})

test('the same holds for a GCP project', async () => {
  expect(await picked('/gcp/p', 'admin', 'ADMINISTRATOR')).toBe(sharedId.toHexString())
  expect(await picked('/gcp/p', 'stranger', 'EDITOR')).toBe(403)
})
