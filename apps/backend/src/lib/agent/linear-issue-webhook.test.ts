import { beforeEach, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useAgentDb } from '@/lib/test/doubles/agent-db'

import { applyLinearIssueWebhook } from './linear-issue-webhook'

let updates: unknown[] = []

useAgentDb({
  agentConversations: () => ({
    updateMany: async (...args: unknown[]) => {
      updates.push(args)

      return { modifiedCount: 1 }
    },
  }),
})
beforeEach(() => {
  updates = []
})

test('Linear issue webhooks refresh the state of every tag linked to that issue', async () => {
  const issueId = '2c0899b2-0284-45ed-9bc8-bd3a1ecf4882'

  await applyLinearIssueWebhook({
    type: 'Issue',
    action: 'update',
    data: {
      id: issueId,
      identifier: 'NUPS-1',
      title: 'Ship it',
      state: { name: 'In Review', type: 'started' },
    },
  })
  const [filter, update] = updates[0] as [
    { 'linkedResources.key': { $regex: string } },
    { $set: Record<string, string> },
  ]
  const pattern = new RegExp(filter['linkedResources.key'].$regex)

  expect(pattern.test(`linear/${new ObjectId().toHexString()}/${issueId}`)).toBe(true)
  expect(pattern.test(`github/1/2/${issueId}`)).toBe(false)
  expect(update.$set).toEqual({
    'linkedResources.$[resource].title': 'NUPS-1 Ship it',
    'linkedResources.$[resource].state': 'In Review',
    'linkedResources.$[resource].stateType': 'started',
  })

  updates = []
  await applyLinearIssueWebhook({ type: 'Comment', data: { id: issueId } })
  await applyLinearIssueWebhook({ type: 'Issue', data: { id: 'not-a-uuid' } })
  expect(updates).toEqual([])
})
