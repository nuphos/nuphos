import assert from 'node:assert/strict'
import { mkdtempSync, utimesSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { enableMacScreen, macScreenStatus, openMacScreen } from './mac-screen.ts'

import type { AddressInfo } from 'node:net'

test('only a Mac shows its screen', () => {
  assert.equal(
    enableMacScreen(tmpdir(), () => undefined, 'linux'),
    null,
  )
})

test('with Screen Sharing off, opening says how to turn it on and holds nothing', async () => {
  const pool = mkdtempSync(path.join(tmpdir(), 'screen-'))
  const server = createServer()

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  await new Promise<void>((resolve) => server.close(() => resolve()))
  await assert.rejects(openMacScreen(pool, 's1', port), /Screen Sharing/u)
  assert.deepEqual(macScreenStatus(pool).desktops, [])
})

test('another conversation gets the screen only once nobody watches it', async () => {
  const pool = mkdtempSync(path.join(tmpdir(), 'screen-'))
  const server = createServer((socket) => socket.destroy())

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  assert.equal(await openMacScreen(pool, 's1', port), 0)
  assert.equal(await openMacScreen(pool, 's1', port), 0)
  await assert.rejects(openMacScreen(pool, 's2', port), /another conversation/u)
  assert.deepEqual(macScreenStatus(pool), {
    desktops: [{ display: 0, sessionId: 's1' }],
    desktopOpen: true,
  })
  // The stream touches the lock every minute while someone watches; four idle minutes free it.
  const idle = new Date(Date.now() - 4 * 60_000)

  utimesSync(path.join(pool, '0.lock'), idle, idle)
  assert.deepEqual(macScreenStatus(pool).desktops, [])
  assert.equal(await openMacScreen(pool, 's2', port), 0)
  assert.deepEqual(macScreenStatus(pool).desktops, [{ display: 0, sessionId: 's2' }])
  server.close()
})

test('two conversations opening the screen at once: one gets it, the other is refused', async () => {
  const pool = mkdtempSync(path.join(tmpdir(), 'screen-'))
  const server = createServer((socket) => socket.destroy())

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  const results = await Promise.allSettled([
    openMacScreen(pool, 's1', port),
    openMacScreen(pool, 's2', port),
  ])

  assert.deepEqual(results.map((result) => result.status).sort(), ['fulfilled', 'rejected'])
  const winner = results[0].status === 'fulfilled' ? 's1' : 's2'

  assert.deepEqual(macScreenStatus(pool).desktops, [{ display: 0, sessionId: winner }])
  server.close()
})
