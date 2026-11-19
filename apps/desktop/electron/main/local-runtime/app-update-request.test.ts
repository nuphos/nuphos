import assert from 'node:assert/strict'
import test from 'node:test'

import { appUpdateStatus, appUpdateTunnel, withAppUpdate } from './app-update-request.ts'

function updater(over: { ready?: { failedBefore: boolean } | null } = {}) {
  const calls = { installed: 0, handled: [] as unknown[] }
  const handle = withAppUpdate(
    async (request) => {
      calls.handled.push(request)

      return { display: 0 }
    },
    {
      ready: () => (over.ready === undefined ? { failedBefore: false } : over.ready),
      install: () => calls.installed++,
      defer: (run) => run(),
    },
  )

  return { handle, calls }
}

test('reports the version and an update only while one is downloading or staged', () => {
  assert.deepEqual(appUpdateStatus('0.120.0', { kind: 'up-to-date' }), { version: '0.120.0' })
  assert.deepEqual(appUpdateStatus('0.120.0', { kind: 'checking' }), { version: '0.120.0' })
  assert.deepEqual(
    appUpdateStatus('0.120.0', {
      kind: 'downloading',
      version: '0.121.0',
      transferred: 1,
      total: 2,
      bytesPerSecond: 1,
    }),
    { version: '0.120.0', update: { version: '0.121.0', ready: false } },
  )
  assert.deepEqual(
    appUpdateStatus('0.120.0', { kind: 'ready', version: '0.121.0', installerUrl: null }),
    { version: '0.120.0', update: { version: '0.121.0', ready: true } },
  )
})

test('restarts into a staged update', async () => {
  const { handle, calls } = updater()

  assert.deepEqual(await handle({ method: 'update' }), {})
  assert.equal(calls.installed, 1)
})

test('refuses with nothing staged, or after a failed install', async () => {
  for (const over of [{ ready: null }, { ready: { failedBefore: true } }]) {
    const { handle, calls } = updater(over)

    await assert.rejects(handle({ method: 'update' }))
    assert.equal(calls.installed, 0)
  }
})

test('passes every other request on', async () => {
  const { handle, calls } = updater()

  assert.deepEqual(await handle({ method: 'desktop', sessionId: 's' }), { display: 0 })
  assert.deepEqual(calls.handled, [{ method: 'desktop', sessionId: 's' }])
  assert.equal(calls.installed, 0)
})

test('the card reads and sets the same switch as Settings > Updates', async () => {
  let enabled = true
  let sent = 0
  const { status, instances } = appUpdateTunnel(
    () => ({ agents: {} }),
    async () => 'handled',
    {
      version: () => '0.126.0',
      state: () => ({ kind: 'idle' }),
      ready: () => null,
      install: () => {},
      changed: () => {
        sent++
      },
      autoInstall: {
        read: () => ({ enabled }),
        write: (value) => {
          enabled = (value as { enabled: boolean }).enabled

          return { enabled }
        },
      },
    },
  )

  assert.deepEqual(status(), { agents: {}, app: { version: '0.126.0' }, autoInstall: true })
  assert.deepEqual(await instances({ method: 'autoInstall', enabled: false }), { enabled: false })
  assert.equal(status().autoInstall, false)
  // Sent at once, so the card shows it.
  assert.equal(sent, 1)
  assert.equal(await instances({ method: 'desktop' }), 'handled')
})
