import { expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { errorHandler } from '@/lib/errors'
import { useAgentSessionsShared } from '@/lib/test/doubles/agent-sessions-shared'
import { useByosAccount } from '@/lib/test/doubles/byos-account'

const { accountScoped } = await import('./aws')

const ACCOUNT = '123456789012'
const teamWide = {
  id: new ObjectId(),
  roleArn: `arn:aws:iam::${ACCOUNT}:role/team`,
  access: { memberAllowList: ['*'], updatedAt: new Date(), updatedBy: 'admin' },
}
const sendersOwn = {
  id: new ObjectId(),
  roleArn: `arn:aws:iam::${ACCOUNT}:role/sender`,
  access: {
    memberAllowList: ['sender'],
    ownerUserId: 'sender',
    updatedAt: new Date(),
    updatedBy: 'sender',
  },
}

useByosAccount({ listAwsBindingsForAccount: async () => [teamWide, sendersOwn] as never })
useAgentSessionsShared({
  getAgentCredentialAccess: async () => ({ awsRoleIds: [sendersOwn.id.toHexString()] }) as never,
})

test("a conversation cannot reach the sender's private role by leaving the role implicit", async () => {
  const root = new Hono()

  root.use('*', async (c, next) => {
    const ctx = c as unknown as { set: (key: string, value: unknown) => void }

    ctx.set('teamId', new ObjectId().toHexString())
    ctx.set('teamRole', 'EDITOR')
    ctx.set('userId', 'sender')
    ctx.set('agent', { userId: 'sender', sessionId: 's', conversationOwnerUserId: 'owner' })
    await next()
  })
  root.route('/:accountId', accountScoped as never)
  root.onError(errorHandler)

  const response = await root.request(`/${ACCOUNT}/credentials`)

  expect(response.status).toBe(403)
  expect(await response.json()).toMatchObject({
    error: { code: 'aws_account_agent_access_denied' },
  })
})
