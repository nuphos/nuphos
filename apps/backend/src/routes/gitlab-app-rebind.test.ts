import { expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useByosGitlab } from '@/lib/test/doubles/byos-gitlab'
import { useModels } from '@/lib/test/doubles/models'

import { persistGitlabBinding } from './gitlab-app'

import type { GitlabBinding } from '@/models'

const existing = {
  id: new ObjectId(),
  hostUrl: 'https://gitlab.example.com',
  accountId: 42,
  createdAt: new Date(0),
  access: { memberAllowList: ['u1'], updatedAt: new Date(0), updatedBy: 'admin' },
} as unknown as GitlabBinding
const writes: Record<string, unknown>[] = []

useByosGitlab({ evictCachedAccessToken: () => undefined })
useModels({
  teamByosBindings: () => ({
    findOne: async () => ({ gitlabAccounts: [existing] }),
    updateOne: async (_filter: unknown, update: Record<string, unknown>) => {
      writes.push(update)

      return { matchedCount: 1 }
    },
  }),
})

test('reauthorizing a GitLab account keeps who may use the binding', async () => {
  const fresh = { memberAllowList: ['*'], updatedAt: new Date(), updatedBy: 'u2' }

  await persistGitlabBinding(
    new ObjectId(),
    { hostUrl: existing.hostUrl, accountId: existing.accountId } as never,
    fresh,
  )

  expect(writes[0]).toMatchObject({
    $set: { 'gitlabAccounts.$[el]': { id: existing.id, access: existing.access } },
  })
})
