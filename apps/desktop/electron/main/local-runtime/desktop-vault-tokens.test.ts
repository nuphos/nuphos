import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

import { buildAtlasError } from '../../atlas/error.ts'

let owners: () => Promise<{ userId: string; name: string }[]> = () =>
  Promise.resolve([
    { userId: 'u1', name: 'Bob' },
    { userId: 'u2', name: 'Alice' },
  ])
const asked: unknown[][] = []

mock.module('../../vault/computer.ts', {
  namedExports: {
    sharers: (...args: unknown[]) => {
      asked.push(args)

      return owners()
    },
    sharedItem: (name: string, owner: string, computer: string) =>
      Promise.resolve(`${name}:${owner}:${computer}`),
  },
})
const { desktopVaultTokens } = await import('./desktop-vault-tokens.ts')

test('Desktop backs an agent with each token shared with its computer, its owner’s included', async () => {
  const list = desktopVaultTokens(() => 'mac-1')
  const tokens = await list()

  assert.deepEqual(asked, [['claude-code-oauth-token', 'mac-1']])
  assert.deepEqual(
    tokens?.map(({ owner, name }) => ({ owner, name })),
    [
      { owner: 'u1', name: 'Bob' },
      { owner: 'u2', name: 'Alice' },
    ],
  )
  assert.equal(await tokens?.[1]?.read(), 'claude-code-oauth-token:u2:mac-1')
  // This device not in a vault, or removed from it: no agents.
  owners = () => Promise.reject(buildAtlasError('Device not found', 'not_found'))
  assert.deepEqual(await list(), [])
  // Offline: unknown, so the agents stay.
  owners = () => Promise.reject(new Error('fetch failed'))
  assert.equal(await list(), null)
})
