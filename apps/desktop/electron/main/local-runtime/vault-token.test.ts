import assert from 'node:assert/strict'
import net from 'node:net'
import test from 'node:test'

import { syncVaultAgents } from './vault-instances.ts'
import {
  CLAUDE_TOKEN_ITEM,
  computerVaultTokens,
  serveVaultToken,
  vaultInstance,
} from './vault-token.ts'

import type { Entry } from './instance-entries.ts'
import type { VaultToken } from './vault-token.ts'

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

const token = (owner: string, name = ''): VaultToken => ({
  owner,
  name,
  read: () => Promise.resolve(null),
})

test('each owner’s token is one agent, with the same id on every start', () => {
  const alice = vaultInstance(token('alice', 'Alice'))

  assert.match(alice.instanceId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u)
  assert.equal(vaultInstance(token('alice', 'Alice')).instanceId, alice.instanceId)
  assert.notEqual(vaultInstance(token('bob')).instanceId, alice.instanceId)
  assert.deepEqual(
    { ...alice, instanceId: '' },
    {
      instanceId: '',
      provider: 'claude-code',
      label: "Claude Code (Alice's token)",
      state: 'ready',
    },
  )
  assert.equal(vaultInstance(token('bob')).label, 'Claude Code (Vault token)')
  assert.ok(vaultInstance(token('carol', 'c'.repeat(200))).label.length <= 100)
})

test('a computer asks with its own credential who shares the token with it', async (t) => {
  const asked: { url: string; authorization?: string }[] = []
  let reply: Response | Error = Response.json({ owners: [{ userId: 'alice', name: 'Alice' }] })

  t.mock.method(globalThis, 'fetch', (url: string, init: RequestInit) => {
    asked.push({ url, authorization: (init.headers as Record<string, string>).authorization })

    return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply)
  })
  const list = computerVaultTokens({ apiUrl: 'https://api.test', credential: 'nbx_test' }, 'nuphos')
  const tokens = await list()

  assert.deepEqual(
    tokens?.map(({ owner, name }) => ({ owner, name })),
    [{ owner: 'alice', name: 'Alice' }],
  )
  assert.deepEqual(asked[0], {
    url: `https://api.test/vault/computer/items?name=${CLAUDE_TOKEN_ITEM}`,
    authorization: 'Bearer nbx_test',
  })
  // The backend could not say: unknown, not unshared.
  reply = new Response('', { status: 503 })
  assert.equal(await list(), null)
  reply = new Error('offline')
  assert.equal(await list(), null)
})

test('the agents follow what is shared now, and a failed listing changes nothing', async () => {
  const entries = new Map<string, Entry>()
  const removed: string[] = []
  const started: string[] = []
  const instances = {
    entries,
    add: (metadata: Entry['metadata'], _userId: string, _install?: unknown, vault?: VaultToken) => {
      const entry = { metadata, vault } as Entry

      entries.set(metadata.instanceId, entry)

      return entry
    },
    remove: (instanceId: string) => {
      entries.delete(instanceId)
      removed.push(instanceId)

      return Promise.resolve()
    },
    start: (entry: Entry) => void started.push(entry.metadata.instanceId),
  }
  const own = { metadata: { instanceId: 'own', provider: 'codex', label: 'Codex' } } as Entry
  const alice = vaultInstance(token('alice')).instanceId
  const bob = vaultInstance(token('bob')).instanceId

  entries.set('own', own)
  await syncVaultAgents(instances, () => Promise.resolve([token('alice')]), 'u1')
  assert.deepEqual([...entries.keys()], ['own', alice])
  assert.deepEqual(started, [])
  await syncVaultAgents(instances, () => Promise.resolve([token('bob')]), 'u1', true)
  assert.deepEqual([...entries.keys()], ['own', bob])
  assert.deepEqual(removed, [alice])
  assert.deepEqual(started, [bob])
  await syncVaultAgents(instances, () => Promise.resolve(null), 'u1', true)
  await syncVaultAgents(instances, () => Promise.reject(new Error('offline')), 'u1', true)
  await syncVaultAgents(instances, undefined, 'u1', true)
  assert.deepEqual([...entries.keys()], ['own', bob])
  await syncVaultAgents(instances, () => Promise.resolve([]), 'u1')
  assert.deepEqual([...entries.keys()], ['own'])
})
