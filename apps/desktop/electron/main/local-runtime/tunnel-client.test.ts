import assert from 'node:assert/strict'
import { test } from 'node:test'

import { RuntimeTunnelClient, TUNNEL_IDLE_TIMEOUT_MS } from './tunnel-client.ts'

type Listener = (event: { data?: unknown; code?: number }) => void

class FakeSocket {
  readyState = 0
  sent: string[] = []
  closed = false
  private listeners = new Map<string, Listener[]>()

  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  emit(type: string, event: { data?: unknown; code?: number } = {}) {
    if (type === 'open') this.readyState = 1
    if (type === 'close') this.readyState = 3
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close(code?: number) {
    if (this.closed) return
    this.closed = true
    this.emit('close', { code: code ?? 1000 })
  }
}

function setup(runtimeUp = true) {
  const backends: FakeSocket[] = []
  const runtimes: { purpose: string; socket: FakeSocket }[] = []
  const changes: [boolean, boolean][] = []
  const client = new RuntimeTunnelClient({
    connectBackend: () => {
      const socket = new FakeSocket()

      backends.push(socket)

      return socket
    },
    connectRuntime: (purpose, provider) => {
      if (!runtimeUp) return null
      const socket = new FakeSocket()

      runtimes.push({ purpose: `${provider}:${purpose}`, socket })

      return socket
    },
    status: () => ({ agents: { 'claude-code': { cli: { installed: true, loggedIn: true } } } }),
    onChange: (connected, superseded) => changes.push([connected, superseded]),
  })

  client.start()
  const backend = () => backends.at(-1) as FakeSocket
  const frames = () => backend().sent.map((raw) => JSON.parse(raw) as Record<string, unknown>)

  return { client, backends, backend, runtimes, frames, changes }
}

test('connected once the socket opens, and it announces the runtime status', () => {
  const { backend, frames, changes, client } = setup()

  backend().emit('open')

  assert.equal(frames()[0]?.t, 'status')
  assert.deepEqual(changes, [[true, false]])
  client.stop()
})

test('relays a stream to that agent’s loopback runtime with the key for its purpose', () => {
  const { backend, runtimes, frames, client } = setup()

  backend().emit('open')
  backend().emit('message', {
    data: JSON.stringify({ t: 'open', s: 's1', purpose: 'control', provider: 'codex' }),
  })
  backend().emit('message', { data: JSON.stringify({ t: 'data', s: 's1', d: 'early' }) })
  const runtime = runtimes[0]

  assert.equal(runtime?.purpose, 'codex:control')
  runtime?.socket.emit('open')
  assert.deepEqual(runtime?.socket.sent, ['early'])
  runtime?.socket.emit('message', { data: 'reply' })
  assert.deepEqual(frames().slice(1), [
    { t: 'opened', s: 's1' },
    { t: 'data', s: 's1', d: 'reply' },
  ])
  backend().emit('message', { data: JSON.stringify({ t: 'close', s: 's1' }) })
  assert.equal(runtime?.socket.closed, true)
  client.stop()
})

test('refuses streams while the runtime is not up', () => {
  const { backend, frames, client } = setup(false)

  backend().emit('open')
  backend().emit('message', { data: JSON.stringify({ t: 'open', s: 's1', purpose: 'transport' }) })

  assert.equal(frames().at(-1)?.t, 'close')
  client.stop()
})

test('answers pings', () => {
  const { backend, frames, client } = setup()

  backend().emit('open')
  backend().emit('message', { data: JSON.stringify({ t: 'ping' }) })

  assert.equal(frames().at(-1)?.t, 'pong')
  client.stop()
})

test('a backend restart or dropped network reconnects with backoff', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { backend, backends, changes, client } = setup()

  backend().emit('open')
  backend().emit('close', { code: 1006 })

  assert.deepEqual(changes.at(-1), [false, false])
  assert.equal(backends.length, 1)
  t.mock.timers.tick(500)
  assert.equal(backends.length, 2)
  client.stop()
})

test('a silent socket is treated as dead and redialed', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { backend, backends, client } = setup()

  backend().emit('open')
  t.mock.timers.tick(TUNNEL_IDLE_TIMEOUT_MS)
  assert.equal(backends[0]?.closed, true)
  t.mock.timers.tick(500)
  assert.equal(backends.length, 2)
  client.stop()
})

test('waking up redials at once instead of waiting out the backoff', () => {
  const { backend, backends, client } = setup()

  backend().emit('open')
  client.reconnectNow()

  assert.equal(backends[0]?.closed, true)
  assert.equal(backends.length, 2)
  client.stop()
})

test('a takeover by another app on this computer stops redialing', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { backend, backends, changes } = setup()

  backend().emit('open')
  backend().emit('close', { code: 4000 })
  t.mock.timers.tick(60_000)

  assert.deepEqual(changes.at(-1), [false, true])
  assert.equal(backends.length, 1)
})

test('stopping drops every stream and the socket', () => {
  const { backend, runtimes, client } = setup()

  backend().emit('open')
  backend().emit('message', { data: JSON.stringify({ t: 'open', s: 's1', purpose: 'transport' }) })
  client.stop()

  assert.equal(runtimes[0]?.socket.closed, true)
  assert.equal(backend().closed, true)
})

test('local exec uses the same tunnel when no local agent is installed', () => {
  const backend = new FakeSocket()
  const exec = new FakeSocket()
  const client = new RuntimeTunnelClient({
    connectBackend: () => backend,
    connectRuntime: () => null,
    connectExec: () => exec,
    status: () => ({ agents: {} }),
  })

  client.start()
  backend.emit('open')
  assert.equal(JSON.parse(backend.sent[0] ?? '{}').status.localExec, true)
  backend.emit('message', { data: JSON.stringify({ t: 'open', s: 'exec-1', purpose: 'exec' }) })
  exec.emit('open')
  backend.emit('message', { data: JSON.stringify({ t: 'data', s: 'exec-1', d: 'echo ok' }) })
  assert.deepEqual(exec.sent, ['echo ok'])
  client.stop()
  assert.equal(exec.closed, true)
  const count = backend.sent.length

  exec.emit('message', { data: 'late result from old session' })
  assert.equal(backend.sent.length, count)
})

test('a socket that never finishes closing still redials after idle', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const sockets: FakeSocket[] = []
  const client = new RuntimeTunnelClient({
    connectBackend: () => {
      const socket = new FakeSocket()

      socket.close = () => {}
      sockets.push(socket)

      return socket
    },
    connectRuntime: () => null,
    status: () => ({ agents: {} }),
  })

  client.start()
  sockets[0]?.emit('open')
  t.mock.timers.tick(TUNNEL_IDLE_TIMEOUT_MS)
  t.mock.timers.tick(500)
  assert.equal(sockets.length, 2)
  client.stop()
})

test('file reads use their own bounded stream and are closed on logout', () => {
  const backend = new FakeSocket()
  const file = new FakeSocket()
  const client = new RuntimeTunnelClient({
    connectBackend: () => backend,
    connectRuntime: () => {
      throw new Error('file read must not become an agent prompt')
    },
    connectFile: () => file,
    status: () => ({ agents: {} }),
  })

  client.start()
  backend.emit('open')
  backend.emit('message', { data: JSON.stringify({ t: 'open', s: 'file-1', purpose: 'file' }) })
  file.emit('open')
  backend.emit('message', {
    data: JSON.stringify({ t: 'data', s: 'file-1', d: '{"path":"report.md"}' }),
  })
  assert.deepEqual(file.sent, ['{"path":"report.md"}'])
  file.emit('message', { data: '{"data":"aGk="}' })
  assert.ok(backend.sent.some((raw) => JSON.parse(raw).d === '{"data":"aGk="}'))
  client.stop()
  assert.equal(file.closed, true)
})

test('dock terminals have a distinct capability and never fall through to local exec', () => {
  const backend = new FakeSocket()
  const terminal = new FakeSocket()
  const client = new RuntimeTunnelClient({
    connectBackend: () => backend,
    connectRuntime: () => null,
    connectExec: () => { throw new Error('Terminal request must not execute as shell text') },
    connectTerminal: () => terminal,
    status: () => ({ agents: {} }),
  })

  client.start()
  backend.emit('open')
  assert.equal(JSON.parse(backend.sent[0] ?? '{}').status.localTerminal, true)
  backend.emit('message', { data: JSON.stringify({ t: 'open', s: 'terminal-1', purpose: 'terminal' }) })
  terminal.emit('open')
  backend.emit('message', { data: JSON.stringify({ t: 'data', s: 'terminal-1', d: '{"action":"open"}' }) })
  assert.deepEqual(terminal.sent, ['{"action":"open"}'])
  client.stop()
})
