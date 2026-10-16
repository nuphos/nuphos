#!/usr/bin/env node
// A desktop per conversation on a Linux Box. Claude Code runs this as the
// session's `nuphos-desktop` MCP server (see box-desktop-mcp.mjs), relaying to
// instabox's computer-use MCP (open-computer-use behind its proxy). Agents start
// every MCP server with the session, so the desktop waits for the first tool
// call: until then the server runs without a display, which is enough to list
// its tools. That call takes a display from the pool, brings up Xvnc + XFCE on
// it under the session's HOME and restarts the server there, so screenshots,
// input and the browser profile are the session's own. When the agent ends the
// session the server dies with it and the display is torn down. `reap` (run by
// the host) removes displays whose owner is gone. Display :1 is instabox's own and is never touched.
//
//   desktop-session.mjs serve            env: NUPHOS_SESSION_ID, NUPHOS_DESKTOP_POOL, NUPHOS_DESKTOP_POOL_SIZE, HOME
//   desktop-session.mjs reap <pool>
//   desktop-session.mjs list <pool>      JSON [{display, sessionId, since}]
//   desktop-session.mjs open <pool> <sessionId> <pid>   prints the display
//
// `open` is a desktop the conversation's owner asked for by hand. Its lock
// names the host's pid and is marked manual: it lives while someone watches it
// (vnc-stream.ts touches the lock) and `reap` frees it after MANUAL_IDLE_MS
// without a viewer. The session's own `serve` adopts it, so from then on it
// follows the agent like any other.

import { spawn, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  closeSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Every display runs as the Box's one Unix user, with no X authority and no VNC
// password: sessions on a Box are not a security boundary from each other, any
// more than their shells are. A Box can be shared by a team, so an agent in one
// person's session can reach another person's display. That risk is accepted for
// now; the fix is a Unix user per session, not a check here.
const FIRST_DISPLAY = 2
const GEOMETRY = '1280x800'
const PROXY = '/usr/local/bin/instabox-computer-use-proxy'
const SERVER = '/usr/local/bin/open-computer-use'
export const MANUAL_IDLE_MS = 10 * 60_000

export const lockFile = (pool, display) => path.join(pool, `${String(display)}.lock`)
export const xdgDir = (pool, display) => path.join(pool, `${String(display)}.xdg`)

export function alive(pid) {
  try {
    process.kill(pid, 0)

    return true
  } catch {
    return false
  }
}

export function readLock(pool, display) {
  try {
    return JSON.parse(readFileSync(lockFile(pool, display), 'utf8'))
  } catch {
    return null
  }
}

/** Every display in the pool that still has a live owner. */
export function listDesktops(pool) {
  if (!existsSync(pool)) return []

  return readdirSync(pool)
    .filter((name) => name.endsWith('.lock'))
    .map((name) => ({
      display: Number(name.slice(0, -5)),
      ...readLock(pool, Number(name.slice(0, -5))),
    }))
    .filter((entry) => entry.sessionId && alive(entry.pid))
    .map(({ display, sessionId, since }) => ({ display, sessionId, since }))
}

const lockEntry = (sessionId, pid, manual) =>
  JSON.stringify({ sessionId, pid, since: new Date().toISOString(), ...(manual && { manual }) })

/**
 * The session's display: its own if it already holds one, else the lowest free
 * one. Slots are files created atomically; one whose owner died stays taken
 * until `reap` frees it, so two sessions starting together cannot tear down
 * each other's fresh claim.
 */
export function claimDisplay(pool, sessionId, size, pid = process.pid, manual = false) {
  mkdirSync(pool, { recursive: true, mode: 0o700 })
  for (let display = FIRST_DISPLAY; display < FIRST_DISPLAY + size; display++) {
    const held = readLock(pool, display)

    if (held?.sessionId === sessionId) {
      // Its own slot, perhaps from a run that died or opened by hand: the agent's
      // server takes it over. (A reap that read the dead pid just before may still
      // clear it; rare, and the next claim takes a fresh slot.)
      if (!alive(held.pid) || (held.manual && !manual))
        writeFileSync(lockFile(pool, display), lockEntry(sessionId, pid))

      return display
    }
    try {
      const fd = openSync(lockFile(pool, display), 'wx', 0o600)

      writeFileSync(fd, lockEntry(sessionId, pid, manual))
      closeSync(fd)

      return display
    } catch {
      // Taken meanwhile: by this same session (two opens at once), it is ours; else try the next one.
      if (readLock(pool, display)?.sessionId === sessionId) return display
    }
  }

  return null
}

const kill = (pattern) => spawnSync('pkill', ['-TERM', '-f', pattern], { stdio: 'ignore' })

/** Ends everything on a display and frees its slot. */
export function teardown(pool, display) {
  const xdg = xdgDir(pool, display)

  kill(`^Xvnc :${String(display)} `)
  // The session bus, by its address; xfce4-session and its clients end with Xvnc.
  kill(`${xdg}/bus`)
  rmSync(lockFile(pool, display), { force: true })
  rmSync(xdg, { recursive: true, force: true })
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Xvnc, a session bus and XFCE on `display`, detached, under `home`; idempotent. */
export async function startDisplay(pool, display, home) {
  const socket = `/tmp/.X11-unix/X${String(display)}`
  const xdg = xdgDir(pool, display)

  mkdirSync(xdg, { recursive: true, mode: 0o700 })
  mkdirSync(home, { recursive: true, mode: 0o700 })
  const env = {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: home,
    USER: process.env.USER ?? os.userInfo().username,
    DISPLAY: `:${String(display)}`,
    XDG_RUNTIME_DIR: xdg,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
    DBUS_SESSION_BUS_ADDRESS: `unix:path=${xdg}/bus`,
    GDK_BACKEND: 'x11',
    XDG_SESSION_TYPE: 'x11',
    LANG: process.env.LANG ?? 'C.UTF-8',
    // Chromium shows its windows to the computer-use server only with this; XFCE
    // turns the desktop's own accessibility switch back off as it starts.
    ACCESSIBILITY_ENABLED: '1',
  }
  const detached = (command, args) =>
    spawn(command, args, { env, detached: true, stdio: 'ignore' }).unref()

  if (!existsSync(socket)) {
    rmSync(`/tmp/.X${String(display)}-lock`, { force: true })
    detached('Xvnc', [
      `:${String(display)}`,
      '-geometry',
      GEOMETRY,
      '-depth',
      '24',
      '-rfbport',
      String(5900 + display),
      '-localhost',
      '-SecurityTypes',
      'None',
      '-AlwaysShared',
      '-desktop',
      `nuphos-${String(display)}`,
      '-nolisten',
      'tcp',
      '-FrameRate',
      '10',
    ])
    for (let i = 0; i < 50 && !existsSync(socket); i++) await sleep(200)
    if (!existsSync(socket)) throw new Error(`Xvnc :${String(display)} did not start`)
  }
  if (!existsSync(`${xdg}/bus`)) {
    spawnSync(
      'dbus-daemon',
      ['--session', `--address=${env.DBUS_SESSION_BUS_ADDRESS}`, '--fork', '--nopidfile'],
      { env, stdio: 'ignore' },
    )
  }
  if (!xfceRunning(display)) detached('env', [`XDG_RUNTIME_DIR=${xdg}`, 'xfce4-session'])

  return env
}

function xfceRunning(display) {
  const out = spawnSync(
    'bash',
    [
      '-c',
      `for p in $(pgrep -x xfce4-session); do tr '\\0' '\\n' < /proc/$p/environ | grep -qx 'DISPLAY=:${String(display)}' && echo yes; done`,
    ],
    { encoding: 'utf8' },
  )

  return (out.stdout ?? '').includes('yes')
}

const REPLAY_ID = 'nuphos-desktop-replay'

const toolError = (id, text) => ({
  jsonrpc: '2.0',
  id,
  result: { content: [{ type: 'text', text }], isError: true },
})

/** Hands each JSON line of `stream` to `onLine`. */
function lines(stream, onLine) {
  let rest = ''

  stream.setEncoding('utf8')
  stream.on('data', (chunk) => {
    const parts = (rest + chunk).split('\n')

    rest = parts.pop() ?? ''
    for (const line of parts) {
      let message

      try {
        message = JSON.parse(line)
      } catch {
        continue // Not a JSON-RPC message; MCP stdio carries nothing else.
      }
      onLine(message)
    }
  })
}

/**
 * The MCP traffic between the agent (`send` writes to it) and the computer-use
 * server, which `start(env)` runs: first without a display, then on the one
 * `desktop()` brings up for the first tool call. The server is told the
 * handshake again after the switch.
 */
export function desktopRelay({ send, start, desktop }) {
  const handshake = []
  let server = start(null)
  let ready = null
  let switching = null

  const fromServer = (message) => {
    if (message.id !== REPLAY_ID) send(message)
  }
  const call = async (message) => {
    try {
      ready ??= await (switching ??= desktop().finally(() => {
        switching = null
      }))
    } catch (error) {
      send(toolError(message.id, error instanceof Error ? error.message : String(error)))

      return
    }
    if (server.env !== ready.env) {
      server.kill()
      server = start(ready.env)
      server.onMessage(fromServer)
      for (const line of handshake) server.send(line)
    }
    server.send(message)
  }
  let queue = Promise.resolve()

  server.onMessage(fromServer)

  return {
    /** One message from the agent, in order: calls wait for the desktop, the rest go on. */
    receive(message) {
      if (message.method === 'initialize') handshake.push({ ...message, id: REPLAY_ID })
      else if (message.method === 'notifications/initialized') handshake.push(message)
      queue = queue.then(() =>
        message.method === 'tools/call' ? call(message) : server.send(message),
      )

      return queue
    },
    get display() {
      return ready?.display ?? null
    },
    server: () => server,
  }
}

/** The computer-use server as a child process, on `env`'s display or none. */
function computerUse(env) {
  const child = spawn('python3', ['-I', PROXY, '--', SERVER, 'mcp'], {
    env: {
      PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
      HOME: process.env.HOME,
      ...env,
      OPEN_COMPUTER_USE_ALLOW_GLOBAL_POINTER_FALLBACKS: '1',
      NO_AT_BRIDGE: '0',
    },
    stdio: ['pipe', 'pipe', 'inherit'],
  })

  return {
    env,
    child,
    send: (message) => child.stdin.write(`${JSON.stringify(message)}\n`),
    onMessage: (handle) => lines(child.stdout, handle),
    kill: () => {
      child.removeAllListeners('exit')
      child.kill('SIGTERM')
    },
  }
}

async function serve() {
  const { NUPHOS_SESSION_ID: sessionId, NUPHOS_DESKTOP_POOL: pool, HOME: home } = process.env
  const size = Number(process.env.NUPHOS_DESKTOP_POOL_SIZE) || os.cpus().length

  if (!sessionId || !pool || !home)
    throw new Error('desktop-session: NUPHOS_SESSION_ID, NUPHOS_DESKTOP_POOL and HOME are required')
  let relay
  const end = () => {
    relay?.server().kill()
    if (relay?.display != null) teardown(pool, relay.display)
    process.exit(0)
  }
  const watched = (env) => {
    const server = computerUse(env)

    server.child.on('exit', end)

    return server
  }

  relay = desktopRelay({
    send: (message) => process.stdout.write(`${JSON.stringify(message)}\n`),
    start: watched,
    desktop: async () => {
      const display = claimDisplay(pool, sessionId, size)

      if (display === null)
        throw new Error(
          `All ${String(size)} desktops on this Box are in use; one frees when its conversation ends.`,
        )
      try {
        return { display, env: await startDisplay(pool, display, home) }
      } catch (error) {
        teardown(pool, display)
        throw error
      }
    },
  })
  lines(process.stdin, (message) => {
    void relay.receive(message)
  })
  // The agent closing stdin ends the session's desktop.
  process.stdin.on('end', end)
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, end)
}

/** Displays whose session is gone, ones opened by hand nobody watched lately, and Xvnc servers (:2 and up) that no session holds. */
export function reap(pool, now = Date.now()) {
  const held = new Set()

  if (existsSync(pool))
    for (const name of readdirSync(pool)) {
      if (!name.endsWith('.lock')) continue
      const display = Number(name.slice(0, -5))
      const lock = readLock(pool, display)

      const idle = lock?.manual && now - statSync(lockFile(pool, display)).mtimeMs > MANUAL_IDLE_MS

      if (lock && alive(lock.pid) && !idle) held.add(display)
      else teardown(pool, display)
    }
  const running = spawnSync('pgrep', ['-a', '-x', 'Xvnc'], { encoding: 'utf8' }).stdout ?? ''

  for (const match of running.matchAll(/Xvnc :(\d+) /gu)) {
    const display = Number(match[1])

    if (display >= FIRST_DISPLAY && !held.has(display)) teardown(pool, display)
  }
}

/**
 * A desktop for `sessionId` held by `pid` (the host): the session's own if it has one.
 * If the backend stops waiting, or Xvnc fails after the lock is written, the slot
 * stays manual and unwatched, so `reap` frees it after MANUAL_IDLE_MS.
 */
export async function open(pool, sessionId, pid) {
  const size = Number(process.env.NUPHOS_DESKTOP_POOL_SIZE) || os.cpus().length
  const display = claimDisplay(pool, sessionId, size, pid, true)

  if (display === null) throw new Error(`This Box has no free desktop (${String(size)} in use).`)
  await startDisplay(pool, display, path.join(xdgDir(pool, display), 'home'))

  return display
}

const [command, argument, ...rest] = process.argv.slice(2)

if (command === 'serve') await serve()
else if (command === 'reap') reap(argument ?? process.env.NUPHOS_DESKTOP_POOL)
else if (command === 'open')
  process.stdout.write(`${String(await open(argument, rest[0], Number(rest[1])))}\n`)
else if (command === 'list')
  process.stdout.write(
    `${JSON.stringify(listDesktops(argument ?? process.env.NUPHOS_DESKTOP_POOL))}\n`,
  )
else if (command !== undefined) {
  process.stderr.write(
    'usage: desktop-session.mjs serve | reap <pool> | list <pool> | open <pool> <sessionId> <pid>\n',
  )
  process.exit(2)
}
