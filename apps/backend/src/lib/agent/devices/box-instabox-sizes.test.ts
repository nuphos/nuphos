import { afterEach, expect, setSystemTime, spyOn, test } from 'bun:test'

import { accountSizes } from './box-instabox-account'

// Reading the account's sizes is the first step of making a Box: one dropped connection
// to instabox must not fail it. Each test uses its own key, as sizes are kept per key.

const me = () =>
  new Response(
    JSON.stringify({
      allowedSpecs: [
        { vcpus: 4, memMiB: 8192 },
        { vcpus: 2, memMiB: 4096 },
      ],
    }),
    {
      status: 200,
    },
  )
const reset = () =>
  Object.assign(new Error('The socket connection was closed unexpectedly'), { code: 'ECONNRESET' })
const spies: { mockRestore: () => void }[] = []

afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore()
  setSystemTime()
})

test('a reset connection is read again once', async () => {
  const fetched = spyOn(globalThis, 'fetch')
    .mockRejectedValueOnce(reset())
    .mockResolvedValueOnce(me())

  spies.push(fetched)
  expect(await accountSizes({ apiKey: 'k1' })).toEqual([
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
  expect(await accountSizes({ apiKey: 'k2' })).toHaveLength(2)
  expect(fetched).toHaveBeenCalledTimes(2)
})

test('a second reset fails the read', async () => {
  const fetched = spyOn(globalThis, 'fetch').mockRejectedValue(reset())

  spies.push(fetched)
  await expect(accountSizes({ apiKey: 'k3' })).rejects.toThrow('closed unexpectedly')
  expect(fetched).toHaveBeenCalledTimes(2)
})

test('a read that timed out is not tried again', async () => {
  const fetched = spyOn(globalThis, 'fetch').mockRejectedValue(
    new DOMException('The operation timed out.', 'TimeoutError'),
  )

  spies.push(fetched)
  await expect(accountSizes({ apiKey: 'k4' })).rejects.toThrow('timed out')
  expect(fetched).toHaveBeenCalledTimes(1)
})

test("a create doesn't wait on instabox for sizes it already read", async () => {
  const fetched = spyOn(globalThis, 'fetch').mockResolvedValueOnce(me())

  spies.push(fetched)
  await accountSizes({ apiKey: 'k5' })
  expect(await accountSizes({ apiKey: 'k5' })).toHaveLength(2)
  expect(fetched).toHaveBeenCalledTimes(1)
})

test('a read that times out later still gives the sizes read before', async () => {
  const fetched = spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(me())
    .mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'))

  spies.push(fetched)
  await accountSizes({ apiKey: 'k6' })
  setSystemTime(Date.now() + 60 * 60_000)
  expect(await accountSizes({ apiKey: 'k6' })).toEqual([
    { vcpus: 2, memMiB: 4096 },
    { vcpus: 4, memMiB: 8192 },
  ])
  expect(fetched).toHaveBeenCalledTimes(2)
})

test('sizes are read again after a while, so a plan change shows', async () => {
  const fetched = spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(me())
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ allowedSpecs: [{ vcpus: 8, memMiB: 16384 }] })),
    )

  spies.push(fetched)
  await accountSizes({ apiKey: 'k7' })
  setSystemTime(Date.now() + 60 * 60_000)
  expect(await accountSizes({ apiKey: 'k7' })).toEqual([{ vcpus: 8, memMiB: 16384 }])
})

test('a key instabox refuses is refused, even if it worked before', async () => {
  const fetched = spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(me())
    .mockResolvedValueOnce(new Response('', { status: 401 }))

  spies.push(fetched)
  await accountSizes({ apiKey: 'k8' })
  setSystemTime(Date.now() + 60 * 60_000)
  await expect(accountSizes({ apiKey: 'k8' })).rejects.toMatchObject({
    code: 'invalid_instabox_api_key',
  })
})

test('while instabox stays down, only one create waits on it every 10 minutes', async () => {
  const fetched = spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(me())
    .mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'))

  spies.push(fetched)
  await accountSizes({ apiKey: 'k9' })
  setSystemTime(Date.now() + 60 * 60_000)
  await accountSizes({ apiKey: 'k9' })
  expect(await accountSizes({ apiKey: 'k9' })).toHaveLength(2)
  expect(fetched).toHaveBeenCalledTimes(2)
})
