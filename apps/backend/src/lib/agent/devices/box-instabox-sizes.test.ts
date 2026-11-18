import { afterEach, expect, spyOn, test } from 'bun:test'

import { accountSizes } from './box-instabox-account'

// Reading the account's sizes is the first step of making a Box: one dropped connection
// to instabox must not fail it.

const me = () =>
  new Response(JSON.stringify({ allowedSpecs: [{ vcpus: 4, memMiB: 8192 }, { vcpus: 2, memMiB: 4096 }] }), {
    status: 200,
  })
const reset = () => Object.assign(new Error('The socket connection was closed unexpectedly'), { code: 'ECONNRESET' })
const spies: { mockRestore: () => void }[] = []

afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore()
})

test('a reset connection is read again once', async () => {
  const fetched = spyOn(globalThis, 'fetch').mockRejectedValueOnce(reset()).mockResolvedValueOnce(me())

  spies.push(fetched)
  expect(await accountSizes({ apiKey: 'k' })).toEqual([
    { vcpus: 2, memMiB: 4096 },
    { vcpus: 4, memMiB: 8192 },
  ])
  expect(fetched).toHaveBeenCalledTimes(2)
})

test('a 503 from instabox is read again once', async () => {
  const fetched = spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response('', { status: 503 }))
    .mockResolvedValueOnce(me())

  spies.push(fetched)
  expect(await accountSizes({ apiKey: 'k' })).toHaveLength(2)
  expect(fetched).toHaveBeenCalledTimes(2)
})

test('a second reset fails the read', async () => {
  const fetched = spyOn(globalThis, 'fetch').mockRejectedValue(reset())

  spies.push(fetched)
  await expect(accountSizes({ apiKey: 'k' })).rejects.toThrow('closed unexpectedly')
  expect(fetched).toHaveBeenCalledTimes(2)
})

test('a read that timed out is not tried again', async () => {
  const fetched = spyOn(globalThis, 'fetch').mockRejectedValue(
    new DOMException('The operation timed out.', 'TimeoutError'),
  )

  spies.push(fetched)
  await expect(accountSizes({ apiKey: 'k' })).rejects.toThrow('timed out')
  expect(fetched).toHaveBeenCalledTimes(1)
})
