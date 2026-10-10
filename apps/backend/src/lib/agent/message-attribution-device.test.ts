import { expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useDb } from '@/lib/test/doubles/db'

import { createMessageMetadata } from './message-attribution'

import type * as dbActual from '@/lib/db'

const sender = '64b7f0c2a1b2c3d4e5f60718'
const devices = [
  { userId: 'someone-else', deviceId: 'theirs', label: 'Their Mac', platform: 'darwin' },
]

devices.push({ userId: sender, deviceId: 'mine', label: 'My Mac', platform: 'darwin' })

const collection = (name: string) => ({
  findOne: async (filter: { userId?: string; deviceId?: string }) =>
    name === 'agent_devices'
      ? (devices.find((d) => d.userId === filter.userId && d.deviceId === filter.deviceId) ?? null)
      : {
          _id: new ObjectId(sender),
          email: 'me@example.com',
          name: 'Me',
          username: 'me',
          createdAt: new Date(),
        },
})

useDb({ db: () => ({ collection }) })

test('only a device registered to the sender is attached, without its id', async () => {
  expect((await createMessageMetadata(sender, 'nuphos', 'mine')).device).toEqual({
    label: 'My Mac',
    platform: 'darwin',
  })
  expect(await createMessageMetadata(sender, 'nuphos', 'theirs')).not.toHaveProperty('device')
  expect(await createMessageMetadata(sender, 'nuphos', 'unknown')).not.toHaveProperty('device')
  expect((await createMessageMetadata(sender, 'nuphos')).sender.email).toBe('me@example.com')
})

test('the email stays out of channels people outside the team can read', async () => {
  expect((await createMessageMetadata(sender, 'slack')).sender.email).toBe('me@example.com')
  for (const source of ['discord', 'lark'] as const)
    expect((await createMessageMetadata(sender, source)).sender).not.toHaveProperty('email')
})
