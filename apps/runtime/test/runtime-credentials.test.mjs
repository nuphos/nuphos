import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { nuphosBridgeMcpServers } from '../image/mcp-bridge-config.mjs'
import { currentAuthorization, relay, tracedRelay } from '../image/mcp-http-bridge.mjs'

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
    http('homelab', 'Bearer s3cret-value'),
    http('other', 'Basic x'),
    {
      ...http('multi', 'Bearer y'),
      headers: [...http('m', 'Bearer y').headers, { name: 'X', value: '1' }],
    },
  ]

  assert.equal(nuphosBridgeMcpServers(servers, {}, '/node'), servers)
  const [bridged, homelab, basic, multi] = nuphosBridgeMcpServers(
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
  // A team's Bearer is not the rotating Nuphos token. Leave it on the HTTP server.
  assert.equal(homelab, servers[1])
  assert.equal(homelab.headers[0].value, 'Bearer s3cret-value')
  assert.equal(basic, servers[2])
  assert.equal(multi, servers[3])
  const [credentials] = nuphosBridgeMcpServers(
    [http('nuphos-credentials', 'Bearer spawn')],
    { OPENAB_CREDENTIALS_DIR: '/c' },
    '/node',
  )
  assert.equal(credentials.command, '/node')
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

test('the MCP bridge answers a call whose keepalive stream ends without JSON', async () => {
  // The backend answers a slow call 200 and sends spaces until its JSON; this one ends first.
  const server = createServer((request, response) => {
    request.resume()
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.write(' ')
      response.end(' ')
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const written = []

  try {
    await relay('{"jsonrpc":"2.0","id":7,"method":"tools/call"}', {
      url: new URL(`http://127.0.0.1:${String(server.address().port)}/mcp`),
      env: {},
      write: (m) => written.push(m),
    })
  } finally {
    server.close()
  }

  assert.deepEqual(written, [
    { jsonrpc: '2.0', id: 7, error: { code: -32000, message: 'Nuphos MCP HTTP 200' } },
  ])
})

test('the MCP bridge logs each call it relays by structure only', async () => {
  const logged = []
  const options = {
    url: new URL('http://backend/mcp'),
    env: {},
    write: () => {},
    log: (entry) => logged.push(entry),
  }

  await tracedRelay('{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"x":"secret"}}', {
    ...options,
    post: async () => ({ status: 200, text: '{"jsonrpc":"2.0","id":1,"result":{"x":"secret"}}' }),
  })
  await tracedRelay('{"jsonrpc":"2.0","id":2,"method":"tools/call"}', {
    ...options,
    post: async () => ({ status: 401, text: '{}' }),
  })
  await tracedRelay('{"jsonrpc":"2.0","method":"notifications/initialized"}', {
    ...options,
    post: async () => ({ status: 202, text: '' }),
  })

  assert.deepEqual(
    logged.map(({ ms: _ms, ...entry }) => entry),
    [
      { event: 'start', ids: [1], method: 'tools/call' },
      { event: 'end', ids: [1], method: 'tools/call', status: 200, bytes: 48, outcome: 'answered' },
      { event: 'start', ids: [2], method: 'tools/call' },
      { event: 'end', ids: [2], method: 'tools/call', status: 401, bytes: 2, outcome: 'error' },
    ],
  )
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
  assert.equal(run(), 'turn-2 turn-2')
  assert.equal(run({ OPENAB_CREDENTIALS_DIR: '' }), 'spawn spawn')
  rmSync(join(dir, 'NUPHOS_TOKEN'))
  assert.equal(run(), ' turn-2', 'a revoked credential unsets the stale env token')
})
