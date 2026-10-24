import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mock, test } from 'node:test'

import type { WebContents } from 'electron'

const noop = () => {}

mock.module('./atlas/client.ts', { namedExports: { readToken: () => Promise.resolve('token') } })
mock.module('./auth-session.ts', {
  namedExports: { authSession: { subscribe: () => noop } },
})
mock.module('./api-endpoint.ts', { namedExports: { apiUrl: () => 'https://api.example.test' } })

class FakeSocket extends EventTarget {
  closed = 0
  close() {
    this.closed++
  }
  send = noop
}
const sockets: FakeSocket[] = []

globalThis.WebSocket = class extends FakeSocket {
  constructor() {
    super()
    sockets.push(this)
  }
} as never

const { RuntimeDesktopSessions } = await import('./runtime-desktop.ts')
const target = { teamId: 'team', sessionId: 'session', display: 1 }
const PAGE_EVENTS = ['destroyed', 'render-process-gone', 'did-start-navigation']

function page() {
  const emitter = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    send: noop,
  })

  return {
    emitter,
    owner: emitter as unknown as WebContents,
    listeners: () => PAGE_EVENTS.reduce((n, event) => n + emitter.listenerCount(event), 0),
  }
}

test('closing desktops leaves no listener on the window', async () => {
  const desktops = new RuntimeDesktopSessions()
  const { owner, listeners } = page()

  for (let i = 0; i < 5; i++) {
    await desktops.start(owner, `view-${String(i)}`, target)
    desktops.close(owner, `view-${String(i)}`)
  }
  assert.equal(listeners(), 0)
})

test('a reload closes the old page’s desktop socket', async () => {
  const desktops = new RuntimeDesktopSessions()
  const { emitter, owner } = page()

  await desktops.start(owner, 'view', target)
  emitter.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
  assert.equal(sockets.at(-1)?.closed, 1)
  // The id is free again for the reloaded page.
  await desktops.start(owner, 'view', target)
  assert.equal(sockets.at(-1)?.closed, 0)
})
