import { promises as fs } from 'node:fs'
import path from 'node:path'

import { expect, mock, test } from 'bun:test'

const scope = `teams/sync-download-${String(Date.now())}`
const objects = Array.from({ length: 40 }, (_, i) => ({
  key: `${scope}/skills/s${String(i)}/SKILL.md`,
  etag: `e${String(i)}`,
  size: 1,
  lastModified: new Date(0),
}))
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
let lists = 0
let fetching = 0
let peak = 0
let fetched = 0
let failing: string | undefined

await mock.module('./skills-s3', () => ({
  isSkillsS3Configured: () => true,
  getSkillsStore: () => ({
    listUnderPrefix: async (prefix: string) => {
      lists += 1
      await sleep(20)

      return objects.map((object) => ({
        ...object,
        key: object.key.replace(`${scope}/`, prefix.replace(/skills\/$/u, '')),
      }))
    },
    getObjectBody: async (key: string) => {
      fetched += 1
      // Fails at once, while the others are still mid-download.
      if (key === failing) throw new Error('store unavailable')
      fetching += 1
      peak = Math.max(peak, fetching)
      await sleep(10)
      fetching -= 1

      return Buffer.from('# skill')
    },
  }),
}))

const { getScopeCacheDir, syncScope } = await import('./sync')

test('a cold cache is filled with bounded parallel fetches, once per scope', async () => {
  // Three requests reach a cold pod together: they share one sync.
  const results = await Promise.all([syncScope(scope), syncScope(scope), syncScope(scope)])

  expect(lists).toBe(1)
  expect(fetched).toBe(objects.length)
  expect(peak).toBeGreaterThan(1)
  expect(peak).toBeLessThanOrEqual(16)
  expect(results.map((result) => result.downloaded)).toEqual([40, 40, 40])
  expect(await fs.readFile(path.join(getScopeCacheDir(scope), 'skills/s39/SKILL.md'), 'utf8')).toBe(
    '# skill',
  )

  // Once it has settled, the next request lists again and fetches nothing unchanged.
  expect((await syncScope(scope)).downloaded).toBe(0)
  expect(lists).toBe(2)
  expect(fetched).toBe(objects.length)
})

test('a failed download stops the sync before it answers', async () => {
  const failed = `${scope}-failing`

  failing = `${failed}/skills/s0/SKILL.md`
  fetched = 0

  await expect(syncScope(failed)).rejects.toThrow('store unavailable')
  // Nothing it started is still writing, and nothing was taken after the failure.
  expect(fetching).toBe(0)
  expect(fetched).toBeLessThanOrEqual(16)
  failing = undefined
})
