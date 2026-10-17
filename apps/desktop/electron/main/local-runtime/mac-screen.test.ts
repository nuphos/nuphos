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

test('the last session to open the screen holds it until nobody watches it', async () => {
  const pool = mkdtempSync(path.join(tmpdir(), 'screen-'))
  const server = createServer((socket) => socket.destroy())

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  assert.equal(await openMacScreen(pool, 's1', port), 0)
  assert.equal(await openMacScreen(pool, 's2', port), 0)
  assert.deepEqual(macScreenStatus(pool), {
    desktops: [{ display: 0, sessionId: 's2' }],
    desktopOpen: true,
  })
  // The stream touches the lock while someone watches; eleven idle minutes free it.
  const idle = new Date(Date.now() - 11 * 60_000)

  utimesSync(path.join(pool, '0.lock'), idle, idle)
  assert.deepEqual(macScreenStatus(pool).desktops, [])
  server.close()
})
