import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { connect, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  enableMacScreen,
  macScreenDeps,
  macScreenStatus,
  openMacScreen,
  screenSocket,
  startHost,
  stopHost,
} from './mac-screen.ts'

const started = async () => undefined

const newPool = () => mkdtempSync(path.join(tmpdir(), 'screen-'))
const tick = () => new Promise((resolve) => setTimeout(resolve, 20))

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

test('the screen opens on request, and streams only to the account signed in on this Mac', async (t) => {
  const pool = newPool()
  let owner: string | null = 'u1'
  const deps = macScreenDeps(pool, () => ({ agents: {} }) as never, {
    binary: () => '/nonexistent',
    handOver: () => undefined,
    owner: () => owner,
  })

  assert.equal(macScreenStatus(pool).desktopOpen, true)
  assert.equal(await openMacScreen(pool, 's1', started), 0)
  const server = createServer((socket) => socket.end())

  t.after(() => server.close())
  await new Promise<void>((resolve) => server.listen(screenSocket(pool), resolve))
  const viewed = async (viewer: string) => {
    const stream = deps.connectVnc()
    let closed = false

    stream.addEventListener('close', () => {
      closed = true
    })
    await tick()
    stream.send(JSON.stringify({ t: 'open', sessionId: 's1', display: 0, viewer }))
    const refused = closed

    stream.close()

    return !refused
  }

  assert.equal(await viewed('u1'), true)
  // A teammate, a forged id, or anyone once this Mac signs out.
  assert.equal(await viewed('mate'), false)
  assert.equal(await viewed(''), false)
  owner = null
  assert.equal(await viewed('u1'), false)
})

test('a host that cannot start says why and holds nothing', async () => {
  const pool = newPool()

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
  const pool = newPool()

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
  const pool = newPool()

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
  const pool = newPool()

  const results = await Promise.allSettled([
    openMacScreen(pool, 's1', started),
    openMacScreen(pool, 's2', started),
  ])

  assert.deepEqual(results.map((result) => result.status).sort(), ['fulfilled', 'rejected'])
  const winner = results[0].status === 'fulfilled' ? 's1' : 's2'

  assert.deepEqual(macScreenStatus(pool).desktops, [{ display: 0, sessionId: winner }])
})
