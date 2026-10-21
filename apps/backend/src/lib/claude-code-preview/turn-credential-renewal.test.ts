import { expect, test } from 'bun:test'

import { RENEWED_TOKEN_TTL_SEC, renewTurnCredentials } from './turn-credential-renewal'

test('each renewal names the credentials it replaces, one at a time', async () => {
  const pushes: [string | undefined, string | undefined][] = []
  let minted = 0
  let inFlight = 0
  const renewal = renewTurnCredentials({
    installed: { NUPHOS_TOKEN: 'turn' },
    renew: (ttlSec) => ({ runtimeEnv: { NUPHOS_TOKEN: `${String(ttlSec)}-${String(++minted)}` } }),
    refresh: async (expected, next) => {
      expect(++inFlight).toBe(1)
      await Bun.sleep(8)
      pushes.push([expected?.NUPHOS_TOKEN, next?.NUPHOS_TOKEN])
      inFlight--
    },
    intervalMs: 3,
  })

  await Bun.sleep(30)
  await renewal.handOff()
  const settled = pushes.length

  await Bun.sleep(20)
  expect(pushes).toHaveLength(settled)
  expect(pushes[0]).toEqual(['turn', `${String(RENEWED_TOKEN_TTL_SEC)}-1`])
  for (let i = 1; i < pushes.length; i++) expect(pushes[i]?.[0]).toBe(pushes[i - 1]?.[1])
  expect(pushes.at(-1)?.[1]).toStartWith(`${String(24 * 60 * 60)}-`)
})

test('a rejected renewal keeps the installed credentials as the next expectation', async () => {
  const expected: (string | undefined)[] = []
  let attempt = 0
  const renewal = renewTurnCredentials({
    installed: { NUPHOS_TOKEN: 'turn' },
    renew: () => ({ runtimeEnv: { NUPHOS_TOKEN: `next-${String(++attempt)}` } }),
    refresh: (current) => {
      expected.push(current?.NUPHOS_TOKEN)

      return attempt === 1 ? Promise.reject(new Error('changed')) : Promise.resolve()
    },
    intervalMs: 60_000,
  })

  await renewal.handOff()
  await renewal.handOff()
  renewal.stop()
  expect(expected).toEqual(['turn', 'turn'])
})
