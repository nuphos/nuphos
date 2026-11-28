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
  screenHost,
  screenSocket,
  startHost,
  stopHost,
} from './mac-screen.ts'

const started = async () => undefined

const newPool = () => mkdtempSync(path.join(tmpdir(), 'screen-'))
const tick = () => new Promise((resolve) => setTimeout(resolve, 20))

/** A stand-in for mac-screen-host (or `name`): a shell script with the given body. */
function fakeHost(body: string, name = 'mac-screen-host'): string {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'host-')), name)

  writeFileSync(file, `#!/bin/sh\n${body}\n`)
  chmodSync(file, 0o755)

  return file
}

// #5321: a Linux computer at its own X11 screen hands it over as a Mac does.
test('a Mac, or a Linux computer on X11 with x0vncserver, shows its screen', () => {
  const PATH = path.dirname(fakeHost('exit 0', 'x0vncserver'))
  const on = (env: NodeJS.ProcessEnv) =>
    enableMacScreen(newPool(), () => undefined, 'linux', env) !== null

  assert.equal(on({ DISPLAY: ':0', PATH }), true)
  // No screen, Wayland, a desktop pool, or nothing to serve it with.
  assert.equal(on({ PATH }), false)
  assert.equal(on({ DISPLAY: ':0', NUPHOS_DESKTOP_POOL: '/pool', PATH }), false)
  assert.equal(on({ DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0', PATH }), false)
  assert.equal(on({ DISPLAY: ':0', PATH: tmpdir() }), false)
  assert.equal(
    enableMacScreen(newPool(), () => undefined, 'win32', { DISPLAY: ':0', PATH }),
    null,
  )
})

test('x0vncserver serves the screen on the pool’s socket only, and says it is this computer’s own', async () => {
  const pool = newPool()
  const host = fakeHost('echo "$@" >&2; exit 1', 'x0vncserver')

  await assert.rejects(
    startHost(pool, host, true),
    new RegExp(
      `^Error: -rfbunixpath ${screenSocket(pool)} -rfbunixmode 0600 -rfbport -1 -SecurityTypes None -MaxDisconnectionTime 60$`,
      'u',
    ),
  )
  assert.equal(macScreenStatus(pool).ownScreen, true)
  // Debian's x0vncserver is a wrapper that forks the server and exits; the server itself runs (#5321).
  const both = path.dirname(fakeHost('exit 0', 'x0vncserver'))

  writeFileSync(path.join(both, 'X0tigervnc'), '')
  chmodSync(path.join(both, 'X0tigervnc'), 0o755)
  assert.equal(screenHost('/bundle', 'linux', both), 'X0tigervnc')
  assert.equal(screenHost('/bundle', 'linux', path.dirname(host)), 'x0vncserver')
  assert.equal(screenHost('/bundle', 'darwin'), '/bundle/mac-screen-host')
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

// #2947: the host's own request for Accessibility shows nothing, so nobody at the Mac knew.
test('opening the screen asks this Mac for its permissions, and the viewer hears why it failed', async () => {
  const pool = newPool()
  const host = fakeHost(
    'echo "mac-screen-host: Accessibility is not allowed for Nuphos yet." >&2; exit 1',
  )
  let asked = 0
  const deps = macScreenDeps(pool, () => ({ agents: {} }) as never, {
    binary: () => host,
    owner: () => 'u1',
    ask: () => {
      asked += 1
    },
  })

  await assert.rejects(
    deps.instances({ method: 'desktop', sessionId: 's1' }),
    /^Error: Accessibility is not allowed for Nuphos yet\.$/u,
  )
  assert.equal(asked, 1)
  assert.deepEqual(macScreenStatus(pool).desktops, [])
})

test('under the CLI the host is asked to hold its own permissions', async () => {
  const pool = newPool()
  const host = fakeHost('echo "mac-screen-host: $2" >&2; exit 1')

  await assert.rejects(startHost(pool, host, true), /^Error: --own-permissions$/u)
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
    ownScreen: true,
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
