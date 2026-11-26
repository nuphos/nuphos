import assert from 'node:assert/strict'
import net from 'node:net'
import test from 'node:test'

import { CLAUDE_TOKEN_ITEM, serveVaultToken } from './vault-token.ts'

/** Asks as the adapter does (nuphosVaultToken in runtime/image/session-home.mjs). */
function nuphosVaultToken(env: Record<string, string>): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    const socket = net.connect(env.NUPHOS_VAULT_SOCKET ?? '', () =>
      socket.write(env.NUPHOS_VAULT_KEY ?? ''),
    )

    socket.on('data', (chunk: Buffer) => chunks.push(chunk))
    socket.on('error', () => socket.destroy())
    socket.on('close', () => resolve(Buffer.concat(chunks).toString('utf8').trim() || null))
  })
}

test('the adapter gets the token as the host reads it now, and only with the key', async () => {
  let shared: string | null = 'sk-ant-oat01-fictional-host'
  let reads = 0
  const env = serveVaultToken(() => {
    reads += 1

    return Promise.resolve(shared)
  })

  assert.equal(await nuphosVaultToken(env), 'sk-ant-oat01-fictional-host')
  // Unshared: the next session asks again and gets nothing.
  shared = null
  assert.equal(await nuphosVaultToken(env), null)
  assert.equal(reads, 2)
  // A read that fails is no token; a wrong key never reaches the vault.
  const failing = serveVaultToken(() => Promise.reject(new Error('not shared')))

  assert.equal(await nuphosVaultToken(failing), null)
  assert.equal(await nuphosVaultToken({ ...env, NUPHOS_VAULT_KEY: 'x'.repeat(64) }), null)
  assert.equal(reads, 2)
  assert.equal(CLAUDE_TOKEN_ITEM, 'claude-code-oauth-token')
})
