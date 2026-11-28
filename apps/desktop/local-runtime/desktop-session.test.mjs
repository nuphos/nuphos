import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { connect } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
  HELD,
  MANUAL_IDLE_MS,
  claimDisplay,
  desktopRelay,
  listDesktops,
  lockFile,
  readLock,
  reap,
  startXvnc,
  vncSocket,
  writeXauthority,
  xauthority,
  xdgDir,
  xvncArgs,
} from './desktop-session.mjs'

test('each session gets its own display, the lowest free one, and keeps it', () => {
  const pool = mkdtempSync(path.join(os.tmpdir(), 'desktops-'))

  assert.equal(claimDisplay(pool, 's1', 3), 2)
  assert.equal(claimDisplay(pool, 's2', 3), 3)
  assert.equal(claimDisplay(pool, 's1', 3), 2)
  assert.equal(claimDisplay(pool, 's3', 3), 4)
  assert.equal(claimDisplay(pool, 's4', 3), null)
  assert.deepEqual(
    listDesktops(pool).map((d) => [d.display, d.sessionId]),
    [
      [2, 's1'],
      [3, 's2'],
      [4, 's3'],
    ],
  )
  assert.equal(readLock(pool, 2)?.pid, process.pid)
})

test('a slot whose owner died is skipped until the reaper frees it', () => {
  const pool = mkdtempSync(path.join(os.tmpdir(), 'desktops-'))

  writeFileSync(
    lockFile(pool, 2),
    JSON.stringify({ sessionId: 'gone', pid: 2 ** 22 - 1, since: 'x' }),
  )
  assert.deepEqual(listDesktops(pool), [])
  assert.equal(claimDisplay(pool, 's1', 2), 3)
  reap(pool)
  assert.equal(readLock(pool, 2), null)
  assert.equal(claimDisplay(pool, 's2', 2), 2)
  // A session whose earlier run died gets its own slot back, under its new pid.
  writeFileSync(
    lockFile(pool, 3),
    JSON.stringify({ sessionId: 's3', pid: 2 ** 22 - 1, since: 'x' }),
  )
  assert.equal(claimDisplay(pool, 's3', 2), 3)
  assert.equal(readLock(pool, 3)?.pid, process.pid)
})

test('a desktop opened by hand is one slot, adopted by the session and freed when unwatched', () => {
  const pool = mkdtempSync(path.join(os.tmpdir(), 'desktops-'))

  // Opening twice claims one display, held by the host and marked manual.
  assert.equal(claimDisplay(pool, 's1', 3, process.pid, true), 2)
  assert.equal(claimDisplay(pool, 's1', 3, process.pid, true), 2)
  assert.deepEqual(readdirSync(pool), ['2.lock'])
  assert.equal(readLock(pool, 2)?.manual, true)
  // The session's own server takes it over; it is no longer manual.
  assert.equal(claimDisplay(pool, 's1', 3, process.ppid), 2)
  assert.equal(readLock(pool, 2)?.pid, process.ppid)
  assert.equal(readLock(pool, 2)?.manual, undefined)

  // A manual desktop nobody watched for MANUAL_IDLE_MS is freed; a watched one stays.
  assert.equal(claimDisplay(pool, 's2', 3, process.pid, true), 3)
  assert.equal(claimDisplay(pool, 's3', 3, process.pid, true), 4)
  const stale = (Date.now() - MANUAL_IDLE_MS - 1_000) / 1000

  utimesSync(lockFile(pool, 3), stale, stale)
  reap(pool)
  assert.deepEqual(
    listDesktops(pool).map((d) => d.sessionId),
    ['s1', 's3'],
  )
})

/** A stand-in computer-use server: answers the handshake and tool list, echoes calls with its display. */
function fakeServers() {
  const started = []
  const start = (env) => {
    let handle
    const server = {
      env,
      got: [],
      killed: false,
      send(message) {
        server.got.push(message)
        const display = env?.DISPLAY ?? 'none'

        if (message.method === 'initialize')
          handle({ id: message.id, result: { instructions: 'computer use' } })
        if (message.method === 'tools/list')
          handle({ id: message.id, result: { tools: [{ name: 'click' }] } })
        if (message.method === 'tools/call')
          handle({ id: message.id, result: { content: [{ type: 'text', text: display }] } })
      },
      onMessage(h) {
        handle = h
      },
      kill() {
        server.killed = true
      },
    }

    started.push(server)

    return server
  }

  return { started, start }
}

const handshake = [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
  { jsonrpc: '2.0', id: 2, method: 'tools/list' },
]

test('the desktop waits for the first tool call; listing tools needs none', async () => {
  const { started, start } = fakeServers()
  const sent = []
  let claims = 0
  const relay = desktopRelay({
    send: (message) => sent.push(message),
    start,
    desktop: () => {
      claims++

      return Promise.resolve({ display: 3, env: { DISPLAY: ':3' } })
    },
  })

  for (const message of handshake) await relay.receive(message)
  assert.equal(claims, 0)
  assert.equal(relay.display, null)
  assert.deepEqual(
    sent[1].result.tools.map((tool) => tool.name),
    ['click'],
  )

  await relay.receive({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'click' } })
  await relay.receive({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'click' } })
  assert.equal(claims, 1)
  assert.equal(relay.display, 3)
  // The display-less server is replaced by one on the desktop, told the handshake again.
  assert.equal(started.length, 2)
  assert.equal(started[0].killed, true)
  assert.deepEqual(
    started[1].got.map((message) => message.method),
    ['initialize', 'notifications/initialized', 'tools/call', 'tools/call'],
  )
  // Its reply to the replayed handshake stays here; the calls' replies reach the agent.
  assert.deepEqual(
    sent.slice(2).map((message) => [message.id, message.result.content[0].text]),
    [
      [3, ':3'],
      [4, ':3'],
    ],
  )
})

test('a full pool answers the call that needs a desktop, and the next call tries again', async () => {
  const { start } = fakeServers()
  const sent = []
  let free = false
  const relay = desktopRelay({
    send: (message) => sent.push(message),
    start,
    desktop: () =>
      free
        ? Promise.resolve({ display: 2, env: { DISPLAY: ':2' } })
        : Promise.reject(new Error('All 4 desktops on this computer are in use')),
  })

  await relay.receive({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'click' } })
  assert.equal(sent[0].result.isError, true)
  assert.match(sent[0].result.content[0].text, /All 4 desktops/u)
  free = true
  await relay.receive({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'click' } })
  assert.equal(sent[1].result.content[0].text, ':2')
})

// While a person holds the desktop (Take over), the agent's input waits for them;
// it may still look. The stream renews the hold, so a lapsed one frees it (#5321).
test('input waits while a person holds the desktop, looking does not', async () => {
  const { started, start } = fakeServers()
  const xdg = mkdtempSync(path.join(os.tmpdir(), 'desktop-xdg-'))
  const sent = []
  const relay = desktopRelay({
    send: (message) => sent.push(message),
    start,
    desktop: () => Promise.resolve({ display: 3, env: { DISPLAY: ':3', XDG_RUNTIME_DIR: xdg } }),
  })
  const call = (id, name) =>
    relay.receive({ jsonrpc: '2.0', id, method: 'tools/call', params: { name } })
  const hold = (since) =>
    writeFileSync(path.join(xdg, 'instabox-control'), `human Sam ${String(since)}\n`)

  for (const message of handshake) await relay.receive(message)
  hold(Math.floor(Date.now() / 1000))
  await call(3, 'click')
  await call(4, 'type_text')
  await call(5, 'get_app_state')
  assert.deepEqual(
    sent.slice(2).map((message) => [message.id, message.result.isError ?? false]),
    [
      [3, true],
      [4, true],
      [5, false],
    ],
  )
  assert.equal(sent[2].result.content[0].text, HELD)
  assert.deepEqual(
    started
      .at(-1)
      .got.filter((message) => message.method === 'tools/call')
      .map((message) => message.id),
    [5],
  )
  // A hold the stream stopped renewing has lapsed.
  hold(Math.floor(Date.now() / 1000) - 31)
  await call(6, 'click')
  assert.equal(sent.at(-1).result.content[0].text, ':3')
})

// The agent's runtime ends a session by signalling its whole process group, which
// already reaches the computer-use server; a second signal from here re-entered its
// handler and left it hung for good, holding the session's home (#4727).
test(
  "ending the session closes the computer-use server's stdin instead of signalling it",
  {
    skip: process.platform === 'win32',
  },
  async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'desktop-session-'))
    const log = path.join(dir, 'proxy.log')

    // Stands in for `open-computer-use mcp`: notes each signal, then EOF on stdin.
    writeFileSync(
      path.join(dir, 'open-computer-use'),
      `#!/bin/sh\ntrap 'echo signal >> "${log}"' TERM HUP INT\necho started >> "${log}"\nwhile read -r line; do :; done\necho eof >> "${log}"\n`,
    )
    chmodSync(path.join(dir, 'open-computer-use'), 0o755)
    const session = spawn(
      process.execPath,
      [new URL('desktop-session.mjs', import.meta.url).pathname, 'serve'],
      {
        env: {
          PATH: `${dir}:/usr/bin:/bin`,
          HOME: dir,
          NUPHOS_SESSION_ID: 'session',
          NUPHOS_DESKTOP_POOL: path.join(dir, 'pool'),
        },
        stdio: ['pipe', 'ignore', 'inherit'],
      },
    )
    const until = async (done) => {
      for (const deadline = Date.now() + 5000; !done() && Date.now() < deadline;)
        await new Promise((resolve) => setTimeout(resolve, 20))
    }

    await until(() => existsSync(log))
    session.kill('SIGTERM')
    await new Promise((resolve) => session.once('exit', resolve))
    await until(() => readFileSync(log, 'utf8').includes('eof'))
    assert.equal(readFileSync(log, 'utf8'), 'started\neof\n')
  },
)

/** What a client reading from `target` gets first: the server's bytes, or the error that refused it. */
const firstRead = (target, hello = '') =>
  new Promise((resolve) => {
    const socket = connect(...target)

    socket.write(hello)
    socket.once('data', (chunk) => {
      resolve(chunk)
      socket.destroy()
    })
    socket.once('error', (error) => resolve(error.code))
  })

/** An X11 connection setup carrying `cookie`, or none: the server answers 1 to accept, 0 to refuse. */
function xHello(cookie) {
  const name = cookie ? Buffer.from('MIT-MAGIC-COOKIE-1\0\0') : Buffer.alloc(0)
  const head = Buffer.from([0x6c, 0, 11, 0, 0, 0, 0, 0, 0, 0, 0, 0])

  head.writeUInt16LE(cookie ? 18 : 0, 6)
  head.writeUInt16LE(cookie ? cookie.length : 0, 8)

  return Buffer.concat([head, name, cookie ?? Buffer.alloc(0)])
}

// Another session runs as the same user, but no other user or container on the
// machine should reach a desktop: X takes only the display's cookie and RFB is
// served only on the display's 0600 socket. Needs a real Xvnc, so it runs on a
// Linux Box image, not on CI.
test(
  'a display takes X clients only with its cookie and serves RFB only on its own 0600 socket',
  { skip: spawnSync('Xvnc', ['-version']).error ? 'needs Xvnc' : false },
  async () => {
    const pool = mkdtempSync(path.join(os.tmpdir(), 'pool-'))
    const display = 90 + Math.floor(Math.random() * 9)
    const x = [`/tmp/.X11-unix/X${String(display)}`]

    mkdirSync(xdgDir(pool, display), { mode: 0o700 })
    writeXauthority(xauthority(pool, display))
    const xvnc = spawn('Xvnc', xvncArgs(pool, display), { stdio: 'ignore' })

    try {
      for (let i = 0; i < 50 && !existsSync(vncSocket(pool, display)); i++)
        await new Promise((resolve) => setTimeout(resolve, 100))
      assert.equal(statSync(vncSocket(pool, display)).mode & 0o777, 0o600)
      assert.equal(statSync(xauthority(pool, display)).mode & 0o777, 0o600)
      assert.match(String(await firstRead([vncSocket(pool, display)])), /^RFB 003\.008/u)
      assert.equal(await firstRead([5900 + display, '127.0.0.1']), 'ECONNREFUSED')
      assert.equal(await firstRead([5900 + display, '::1']), 'ECONNREFUSED')
      const cookie = readFileSync(xauthority(pool, display)).subarray(-16)

      assert.equal((await firstRead(x, xHello()))[0], 0)
      assert.equal((await firstRead(x, xHello(Buffer.alloc(16))))[0], 0)
      assert.equal((await firstRead(x, xHello(cookie)))[0], 1)
    } finally {
      xvnc.kill()
    }
  },
)

// A display an older runtime started listens on a TCP port with no cookie. The next
// start replaces it, so it ends up on its own socket like a fresh one.
test(
  'a display started without its own RFB socket is replaced by one with it',
  { skip: spawnSync('Xvnc', ['-version']).error ? 'needs Xvnc' : false },
  async () => {
    const pool = mkdtempSync(path.join(os.tmpdir(), 'pool-'))
    const display = 80 + Math.floor(Math.random() * 9)
    const old = spawn(
      'Xvnc',
      [
        `:${String(display)}`,
        '-rfbport',
        String(5900 + display),
        '-localhost',
        '-SecurityTypes',
        'None',
      ],
      { stdio: 'ignore' },
    )

    try {
      for (let i = 0; i < 50 && !existsSync(`/tmp/.X11-unix/X${String(display)}`); i++)
        await new Promise((resolve) => setTimeout(resolve, 100))
      assert.match(String(await firstRead([5900 + display, '127.0.0.1'])), /^RFB/u)
      mkdirSync(xdgDir(pool, display), { mode: 0o700 })
      assert.equal(await startXvnc(pool, display, process.env), true)
      assert.match(String(await firstRead([vncSocket(pool, display)])), /^RFB 003\.008/u)
      assert.equal(await firstRead([5900 + display, '127.0.0.1']), 'ECONNREFUSED')
      assert.equal(await startXvnc(pool, display, process.env), false)
    } finally {
      old.kill()
      spawnSync('pkill', ['-TERM', '-f', `^Xvnc :${String(display)} `])
    }
  },
)
