import assert from 'node:assert/strict'
import { before, mock, test } from 'node:test'

import type * as ChangelogModule from './changelog.ts'

let cloud = false
let requests = 0
let finish: ((response: Response) => void) | undefined
let delayed = false
const feed = {
  version: 1,
  entries: [
    {
      slug: 'test',
      title: 'Test',
      summary: 'Test',
      date: '2026-11-19',
      coverUrl: 'https://nuphos.ai/test.png',
      url: 'https://nuphos.ai/changelog/test',
    },
  ],
}
let changelog: typeof ChangelogModule

before(async () => {
  mock.module('electron', { namedExports: { BrowserWindow: { getAllWindows: () => [] } } })
  mock.module('../api-endpoint.ts', { namedExports: { isNuphosCloud: () => cloud } })
  mock.method(globalThis, 'fetch', () => {
    requests++

    return delayed
      ? new Promise<Response>((resolve) => {
          finish = resolve
        })
      : Promise.resolve(Response.json(feed))
  })
  changelog = await import('./changelog.ts')
})

test('self-hosted polling makes no Cloud request', async () => {
  await changelog.fetchChangelogOnce()
  assert.equal(requests, 0)
  assert.deepEqual(changelog.getChangelogState(), { kind: 'unavailable' })
})

test('Cloud fetches its feed; a response after switching away is ignored', async () => {
  cloud = true
  await changelog.fetchChangelogOnce()
  assert.equal(requests, 1)
  assert.equal(changelog.getChangelogState().kind, 'ready')
  delayed = true
  const pending = changelog.fetchChangelogOnce()

  cloud = false
  finish?.(Response.json(feed))
  await pending
  assert.deepEqual(changelog.getChangelogState(), { kind: 'unavailable' })
})
