import { expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useByosAccount } from '@/lib/test/doubles/byos-account'

import { resolveDatabaseNetwork } from './database-network'

const access = {
  memberAllowList: ['owner'],
  ownerUserId: 'owner',
  updatedAt: new Date(),
  updatedBy: 'owner',
}

useByosAccount({
  findTailscaleClient: async () =>
    ({ id: new ObjectId(), access, encryptedClientSecret: {} }) as never,
})

test('a database connection cannot reach the network through a Tailscale binding the member may not use', async () => {
  const tailscale = { bindingId: new ObjectId(), tag: 'tag:db' }

  await expect(
    resolveDatabaseNetwork(new ObjectId(), 'tailscale', tailscale, () => false),
  ).rejects.toMatchObject({ status: 403, code: 'database_tailscale_binding_access_denied' })
})
