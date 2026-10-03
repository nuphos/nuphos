import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { after, mock, test } from 'node:test'

import { authSession } from './auth-session.ts'

import type { WebContents } from 'electron'

let token: Promise<string> = Promise.resolve('fixture')

mock.module('./atlas/client.ts', {
  namedExports: { ATLAS_URL: 'https://backend.test', readToken: () => token },
})
const { RuntimeTerminalSessions, runtimeTerminals } = await import('./runtime-terminal.ts')
const original = globalThis.WebSocket
const sockets: FakeSocket[] = []

class FakeSocket extends EventTarget {
  sent: string[] = []
  closed = false
  readonly url: URL
  constructor(url: URL) {
    super()
    this.url = url
    sockets.push(this)
  }
  send(data: string) {
    this.sent.push(data)
  }
  close() {
    this.closed = true
  }
  frame(value: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) }))
  }
}
globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket
after(() => {
  globalThis.WebSocket = original
})
function owner() {
  const events: unknown[] = []
  const value = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    send: (_channel: string, event: unknown) => events.push(event),
  })

  return { value: value as unknown as WebContents, events }
}
test('reattaches to one connection, acknowledges bytes, and closes with its owner', async () => {
  const manager = new RuntimeTerminalSessions()
  const host = owner()
  const target = { teamId: 'team', sessionId: 'session' }
  const pending = manager.start(host.value, 'tab', target, 132, 43)

  await new Promise(setImmediate)
  const socket = sockets.at(-1)!

  assert.equal(socket.url.searchParams.get('cols'), '132')
  assert.equal(socket.url.searchParams.get('rows'), '43')
  socket.frame({ type: 'ready', label: 'Cloud runtime' })
  assert.equal((await pending).shell, 'Cloud runtime')
  assert.equal(await manager.start(host.value, 'tab', target), await pending)
  socket.frame({ type: 'data', sequence: 1, data: Buffer.from('hello').toString('base64') })
  assert.deepEqual(JSON.parse(socket.sent.at(-1)!), { type: 'ack', sequence: 1 })
  manager.input(host.value, 'tab', '\x00'.repeat(16384))
  assert.equal(JSON.parse(socket.sent.at(-1)!).data.length, 16384)
  assert.throws(() => manager.input(host.value, 'tab', '界'.repeat(6000)), /too large/)
  assert.equal(socket.closed, false)
  manager.input(host.value, 'tab', 'still usable')
  assert.equal(JSON.parse(socket.sent.at(-1)!).data, 'still usable')
  manager.replay(host.value, 'tab')
  assert.equal(host.events.length, 2)
  assert.throws(() => manager.describe(owner().value, 'tab'), /another window/)
  manager.resize(host.value, 'tab', 80, 24)
  manager.resize(host.value, 'tab', 120, 40)
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.deepEqual(JSON.parse(socket.sent.at(-1)!), { type: 'resize', cols: 120, rows: 40 })
  assert.equal(socket.sent.filter((frame) => JSON.parse(frame).type === 'resize').length, 1)
  host.value.emit('destroyed')
  assert.equal(socket.closed, true)
})
test('closing during credential lookup never opens a connection', async () => {
  let resolve!: (value: string) => void

  token = new Promise<string>((done) => {
    resolve = done
  })
  const manager = new RuntimeTerminalSessions()
  const host = owner()
  const count = sockets.length
  const pending = manager.start(host.value, 'tab', { teamId: 'team', sessionId: 'session' })
  const rejected = assert.rejects(pending, /closed/)

  manager.close(host.value, 'tab')
  resolve('fixture')
  await rejected
  assert.equal(sockets.length, count)
  token = Promise.resolve('fixture')
})

test('authentication transitions close existing runtime sockets', async () => {
  const host = owner()
  const pending = runtimeTerminals.start(host.value, 'auth-tab', {
    teamId: 'team',
    sessionId: 'session',
  })

  await new Promise(setImmediate)
  const socket = sockets.at(-1)!

  socket.frame({ type: 'ready', label: 'Runtime' })
  await pending
  authSession.set('different-auth-session')
  assert.equal(socket.closed, true)
  assert.equal(runtimeTerminals.describe(host.value, 'auth-tab'), undefined)
  authSession.set(null)
})
