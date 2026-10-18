import { expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useDb } from '@/lib/test/doubles/db'

let pending: { status: string } | null = null
let stored = 0

useDb({
  db: () => ({
    collection: (name: string) => ({
      findOne: async () => (name === 'account_deletion_requests' ? pending : null),
      replaceOne: async () => {
        stored += 1

        return {}
      },
    }),
  }),
})

const { uploadAvatar } = await import('./avatar-upload')

test('an upload is refused while the account has an open deletion request', async () => {
  pending = { status: 'requested' }
  stored = 0
  await expect(
    uploadAvatar(new ObjectId().toHexString(), new Uint8Array([1])),
  ).rejects.toMatchObject({
    status: 409,
    code: 'account_deletion_pending',
  })
  expect(stored).toBe(0)
})
