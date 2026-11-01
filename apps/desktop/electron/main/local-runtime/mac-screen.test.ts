import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  enableMacScreen,
  macScreenStatus,
  openMacScreen,
  screenSocket,
  setMacScreenAllowed,
  startHost,
  stopHost,
} from './mac-screen.ts'

const started = async () => undefined

/** A pool whose Mac has turned "Let my phone see and control this Mac" on. */
function allowedPool(): string {
  const pool = mkdtempSync(path.join(tmpdir(), 'screen-'))

  setMacScreenAllowed(pool, true)

  return pool
}

/** A stand-in for mac-screen-host: a shell script with the given body. */
function fakeHost(body: string): string {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'host-')), 'mac-screen-host')

  writeFileSync(file, `#!/bin/sh\n${body}\n`)
  chmodSync(file, 0o755)

  return file
}

test('only a Mac shows its screen', () => {
  assert.equal(
    enableMacScreen(tmpdir(), () => undefined, 'linux'),
    null,
  )
})

test('the screen stays closed until the Mac turns phone control on, and closes when it is turned off', async () => {
  const pool = mkdtempSync(path.join(tmpdir(), 'screen-'))
  let starts = 0
  const start = async () => {
    starts += 1
  }

  assert.equal(macScreenStatus(pool).desktopOpen, false)
  await assert.rejects(openMacScreen(pool, 's1', start), /Let my phone see and control this Mac/u)
  assert.equal(starts, 0)

  setMacScreenAllowed(pool, true)
  assert.equal(macScreenStatus(pool).desktopOpen, true)
  assert.equal(await openMacScreen(pool, 's1', start), 0)

  setMacScreenAllowed(pool, false)
  assert.deepEqual(macScreenStatus(pool), { desktops: [], desktopOpen: false })
})

test('a host that cannot start says why and holds nothing', async () => {
  const pool = allowedPool()

  const host = fakeHost(
    'echo "mac-screen-host: Screen Recording is not allowed for Nuphos yet" >&2; exit 1',
  )

  await assert.rejects(
    openMacScreen(pool, 's1', () => startHost(pool, host)),
    /^Error: Screen Recording is not allowed/u,
  )
  assert.deepEqual(macScreenStatus(pool).desktops, [])
})

test('the host starts once, and opening waits until it listens', async () => {
  const pool = allowedPool()

  const host = fakeHost(
    `exec "${process.execPath}" -e "require('node:net').createServer().listen(process.argv[1])" "$1"`,
  )

  assert.equal(await openMacScreen(pool, 's1', () => startHost(pool, host)), 0)
  await new Promise<void>((resolve, reject) => {
    const socket = connect(screenSocket(pool), () => {
      socket.destroy()
      resolve()
    })

    socket.once('error', reject)
  })
  // A host already listening is reused rather than started again.
  await startHost(pool, '/nonexistent/mac-screen-host')
  stopHost()
})

test('another conversation gets the screen only once nobody watches it', async () => {
  const pool = allowedPool()

  assert.equal(await openMacScreen(pool, 's1', started), 0)
  assert.equal(await openMacScreen(pool, 's1', started), 0)
  await assert.rejects(openMacScreen(pool, 's2', started), /another agent/u)
  assert.deepEqual(macScreenStatus(pool), {
    desktops: [{ display: 0, sessionId: 's1' }],
    desktopOpen: true,
  })
  // The stream touches the lock every minute while someone watches; four idle minutes free it.
  const idle = new Date(Date.now() - 4 * 60_000)

  utimesSync(path.join(pool, '0.lock'), idle, idle)
  assert.deepEqual(macScreenStatus(pool).desktops, [])
  assert.equal(await openMacScreen(pool, 's2', started), 0)
  assert.deepEqual(macScreenStatus(pool).desktops, [{ display: 0, sessionId: 's2' }])
})

test('two conversations opening the screen at once: one gets it, the other is refused', async () => {
  const pool = allowedPool()

  const results = await Promise.allSettled([
    openMacScreen(pool, 's1', started),
    openMacScreen(pool, 's2', started),
  ])

  assert.deepEqual(results.map((result) => result.status).sort(), ['fulfilled', 'rejected'])
  const winner = results[0].status === 'fulfilled' ? 's1' : 's2'

  assert.deepEqual(macScreenStatus(pool).desktops, [{ display: 0, sessionId: winner }])
})
