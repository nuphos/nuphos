import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { nuphosBridgeMcpServers } from '../image/mcp-bridge-config.mjs'
import { currentAuthorization, relay } from '../image/mcp-http-bridge.mjs'

const guard = fileURLToPath(new URL('../image/runtime-guard.sh', import.meta.url))

function credentialsDir(token) {
  const dir = mkdtempSync(join(tmpdir(), 'nuphos-credentials-'))

  writeFileSync(join(dir, 'NUPHOS_TOKEN'), token)
  writeFileSync(join(dir, 'NUPHOS_PLAN_API_TOKEN'), token)

  return dir
}

const http = (name, value) => ({
  name,
  type: 'http',
  url: `http://backend/${name}`,
  headers: [{ name: 'Authorization', value }],
})

test('bearer-only Nuphos MCP servers are bridged only when credential files exist', () => {
  const servers = [
    http('nuphos-tools', 'Bearer spawn'),
    http('other', 'Basic x'),
    {
      ...http('multi', 'Bearer y'),
      headers: [...http('m', 'Bearer y').headers, { name: 'X', value: '1' }],
    },
  ]

  assert.equal(nuphosBridgeMcpServers(servers, {}, '/node'), servers)
  const [bridged, basic, multi] = nuphosBridgeMcpServers(
    servers,
    { OPENAB_CREDENTIALS_DIR: '/c' },
    '/node',
  )

  assert.deepEqual(bridged, {
    name: 'nuphos-tools',
    command: '/node',
    args: ['/opt/nuphos-runtime/mcp-http-bridge.mjs', 'http://backend/nuphos-tools'],
    env: [{ name: 'OPENAB_CREDENTIALS_DIR', value: '/c' }],
  })
  assert.equal(basic, servers[1])
  assert.equal(multi, servers[2])
})

test('the MCP bridge authorizes every request with the token current at call time', async () => {
  const dir = credentialsDir('turn-1')
  const env = { OPENAB_CREDENTIALS_DIR: dir }
  const seen = []
  const written = []
  const post = async (_url, headers, body) => {
    seen.push(headers.authorization)
    const { id } = JSON.parse(body)

    return id === undefined
      ? { status: 202, text: '' }
      : { status: 200, text: JSON.stringify({ jsonrpc: '2.0', id, result: { ok: id } }) }
  }
  const options = { url: new URL('http://backend/mcp'), env, post, write: (m) => written.push(m) }

  await relay('{"jsonrpc":"2.0","id":1,"method":"tools/list"}', options)
  writeFileSync(join(dir, 'NUPHOS_TOKEN'), 'turn-2\n')
  await relay('{"jsonrpc":"2.0","method":"notifications/initialized"}', options)

  assert.deepEqual(seen, ['Bearer turn-1', 'Bearer turn-2'])
  assert.deepEqual(written, [{ jsonrpc: '2.0', id: 1, result: { ok: 1 } }])
  rmSync(join(dir, 'NUPHOS_TOKEN'))
  await relay('{"jsonrpc":"2.0","id":2,"method":"tools/list"}', options)
  assert.equal(seen.length, 3)
  assert.equal(seen[2], undefined, 'a revoked credential sends no authorization')
  assert.equal(currentAuthorization({ OPENAB_CREDENTIALS_DIR: join(dir, 'missing') }), undefined)
})

test('the MCP bridge turns transport and HTTP failures into JSON-RPC errors', async () => {
  const written = []
  const base = { url: new URL('http://backend/mcp'), env: {}, write: (m) => written.push(m) }

  await relay('{"jsonrpc":"2.0","id":7,"method":"tools/call"}', {
    ...base,
    post: async () => ({ status: 401, text: '{"code":"unauthorized"}' }),
  })
  await relay('{"jsonrpc":"2.0","id":8,"method":"tools/call"}', {
    ...base,
    post: async () => {
      throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' })
    },
  })
  await relay('not json', { ...base, post: async () => assert.fail('must not post') })

  assert.deepEqual(written, [
    {
      jsonrpc: '2.0',
      id: 7,
      error: { code: -32000, message: 'Nuphos MCP HTTP 401: {"code":"unauthorized"}' },
    },
    {
      jsonrpc: '2.0',
      id: 8,
      error: { code: -32000, message: 'Nuphos MCP request failed: ECONNREFUSED' },
    },
    { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } },
  ])
})

test('every bash, nested ones included, reads the current conversation token', () => {
  const dir = credentialsDir('turn-1')
  const run = (extra = {}) =>
    spawnSync('bash', ['-c', 'printf "%s %s" "$NUPHOS_TOKEN" "$NUPHOS_PLAN_API_TOKEN"'], {
      env: {
        PATH: process.env.PATH,
        BASH_ENV: guard,
        OPENAB_CREDENTIALS_DIR: dir,
        NUPHOS_TOKEN: 'spawn',
        NUPHOS_PLAN_API_TOKEN: 'spawn',
        ...extra,
      },
      encoding: 'utf8',
      // bash sources ~/.bashrc instead of BASH_ENV when stdin is a socket.
      stdio: ['ignore', 'pipe', 'pipe'],
    }).stdout

  assert.equal(run(), 'turn-1 turn-1')
  writeFileSync(join(dir, 'NUPHOS_TOKEN'), 'turn-2')
  writeFileSync(join(dir, 'NUPHOS_PLAN_API_TOKEN'), 'turn-2')
  assert.equal(run({ NUPHOS_RUNTIME_GUARD: '1' }), 'turn-2 turn-2')
  assert.equal(run({ OPENAB_CREDENTIALS_DIR: '' }), 'spawn spawn')
  rmSync(join(dir, 'NUPHOS_TOKEN'))
  assert.equal(run(), ' turn-2', 'a revoked credential unsets the stale env token')
})
