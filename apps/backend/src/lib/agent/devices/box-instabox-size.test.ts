import { afterEach, beforeEach, expect, test } from 'bun:test'

import { config } from '@/config'

import { boxSize, boxSizes } from './box-instabox-limit'

// A new Box is one of the sizes instabox lists in the account's `allowedSpecs`.
const savedInstabox = config.box.instabox
const savedFetch = globalThis.fetch
let me: unknown

beforeEach(() => {
  config.box.instabox = { apiKey: 'ibk_test', apiUrl: 'https://instabox.test' }
  me = {
    allowedSpecs: [
      { vcpus: 8, memMiB: 16384, persistentDiskGiB: 20 },
      { vcpus: 4, memMiB: 8192, persistentDiskGiB: 20 },
    ],
  }
  globalThis.fetch = ((url: string) =>
    Promise.resolve(
      url === 'https://instabox.test/v1/me'
        ? Response.json(me)
        : new Response('not found', { status: 404 }),
    )) as typeof fetch
})

// Config and fetch are shared by every test file in this process: put them back.
afterEach(() => {
  config.box.instabox = savedInstabox
  globalThis.fetch = savedFetch
})

test('the sizes are the allowed specs, smallest first', async () => {
  expect(await boxSizes()).toEqual([
    { vcpus: 4, memMiB: 8192 },
    { vcpus: 8, memMiB: 16384 },
  ])
})

test('a chosen size gets its memory; none chosen is the smallest', async () => {
  expect(await boxSize(8)).toEqual({ vcpus: 8, memMiB: 16384 })
  expect(await boxSize()).toEqual({ vcpus: 4, memMiB: 8192 })
})

test('a size instabox does not offer is refused', async () => {
  await expect(boxSize(16)).rejects.toMatchObject({
    status: 400,
    code: 'box_size',
    message: 'A Box comes with 4 or 8 vCPU',
  })
})

test('an account with no allowed size is an outage, not an empty choice', async () => {
  me = {}
  await expect(boxSizes()).rejects.toMatchObject({ status: 503, code: 'box_unavailable' })
})
