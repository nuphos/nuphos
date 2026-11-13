import { expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import { setupTokenUsageIndexes } from './token-usage-db'

import type { Document } from 'mongodb'

const created: Document[] = []
const neverBuilt = new Promise<string>((resolve) => setTimeout(resolve, 60_000).unref())
let triggerIndex: Promise<string> = Promise.resolve('')

const usageCollection = {
  createIndex: (keys: Document) => {
    created.push(keys)

    return 'triggerId' in keys ? triggerIndex : Promise.resolve('ok')
  },
}

useDb({ db: () => ({ collection: () => usageCollection }) })

test('boot does not wait for the per-Trigger index to build', async () => {
  created.length = 0
  triggerIndex = neverBuilt

  const done = await Promise.race([
    setupTokenUsageIndexes().then(() => 'done'),
    new Promise((resolve) => setTimeout(() => resolve('timed out'), 200)),
  ])

  expect(done).toBe('done')
  expect(created).toContainEqual({ triggerId: 1, createdAt: -1 })
})

test('a failed per-Trigger index build does not reject the setup', async () => {
  created.length = 0
  triggerIndex = Promise.reject(new Error('build failed'))

  await expect(setupTokenUsageIndexes()).resolves.toBeUndefined()
  await Bun.sleep(0)
  expect(created).toContainEqual({ triggerId: 1, createdAt: -1 })
})
