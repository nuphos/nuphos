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
let stored: GitlabBinding = existing

useByosGitlab({ evictCachedAccessToken: () => undefined })
useModels({
  teamByosBindings: () => ({
    findOne: async () => ({ gitlabAccounts: [stored] }),
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

test('reauthorizing a binding from before member lists keeps it open to the team', async () => {
  const { access: _none, ...legacy } = existing

  stored = legacy as GitlabBinding
  writes.length = 0

  await persistGitlabBinding(
    new ObjectId(),
    { hostUrl: existing.hostUrl, accountId: existing.accountId } as never,
    { memberAllowList: ['u2'], ownerUserId: 'u2', updatedAt: new Date(), updatedBy: 'u2' },
  )

  const written = (writes[0] as { $set: Record<string, GitlabBinding> }).$set[
    'gitlabAccounts.$[el]'
  ]

  expect(written).not.toHaveProperty('access')
})
