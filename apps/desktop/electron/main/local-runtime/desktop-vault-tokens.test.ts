import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

import { buildAtlasError } from '../../atlas/error.ts'

let reply: () => Promise<string> = () => Promise.resolve('sk-ant-oat01-fictional')

mock.module('../../vault/vault.ts', { namedExports: { getItem: () => reply() } })
const { desktopVaultTokens } = await import('./desktop-vault-tokens.ts')

test('Desktop backs an agent with its owner’s token only while it opens', async () => {
  const list = desktopVaultTokens(() => 'u1')
  const tokens = await list()

  assert.deepEqual(
    tokens?.map(({ owner, name }) => ({ owner, name })),
    [{ owner: 'u1', name: '' }],
  )
  assert.equal(await tokens?.[0]?.read(), 'sk-ant-oat01-fictional')
  // Not shared, or this device not in the vault: no agent.
  reply = () => Promise.reject(buildAtlasError('Item not found', 'not_found'))
  assert.deepEqual(await list(), [])
  reply = () => Promise.reject(buildAtlasError('Approve this device first.', 'vault_desktop'))
  assert.deepEqual(await list(), [])
  // Offline: unknown, so the agent stays.
  reply = () => Promise.reject(new Error('fetch failed'))
  assert.equal(await list(), null)
})
