#!/usr/bin/env node
// A desktop per conversation on a Linux Box. Claude Code runs this as the
// session's `computer-use` MCP server (see box-desktop-mcp.mjs): it takes a
// display from the pool, brings up Xvnc + XFCE on it under the session's HOME,
// then execs instabox's computer-use MCP (open-computer-use behind its proxy)
// with DISPLAY set, so screenshots, input and the browser profile are the
// session's own. When Claude Code ends the session the server dies with it and
// the display is torn down. `reap` (run by the host) removes displays whose
// owner is gone. Display :1 is instabox's own and is never touched.
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

async function serve() {
  const { NUPHOS_SESSION_ID: sessionId, NUPHOS_DESKTOP_POOL: pool, HOME: home } = process.env
  const size = Number(process.env.NUPHOS_DESKTOP_POOL_SIZE) || os.cpus().length

  if (!sessionId || !pool || !home)
    throw new Error('desktop-session: NUPHOS_SESSION_ID, NUPHOS_DESKTOP_POOL and HOME are required')
  const display = claimDisplay(pool, sessionId, size)

  if (display === null) {
    // No slot: answer the agent's first request with an MCP error instead of hanging.
    process.stdin.on('data', (chunk) => {
      for (const line of String(chunk).split('\n')) {
        const id = /"id"\s*:\s*("[^"]*"|\d+)/u.exec(line)?.[1]

        if (id)
          process.stdout.write(
            `${JSON.stringify({ jsonrpc: '2.0', id: JSON.parse(id), error: { code: -32000, message: `This Box has no free desktop (${String(size)} in use); wait for a session to end or use another Box.` } })}\n`,
          )
      }
    })

    return
  }
  const env = await startDisplay(pool, display, home)
  const proxy = spawn('python3', ['-I', PROXY, '--', SERVER, 'mcp'], {
    env: { ...env, OPEN_COMPUTER_USE_ALLOW_GLOBAL_POINTER_FALLBACKS: '1', NO_AT_BRIDGE: '0' },
    stdio: 'inherit',
  })
  const end = () => {
    proxy.kill('SIGTERM')
    teardown(pool, display)
    process.exit(0)
  }

  // stdin belongs to the proxy (inherited); it exits when Claude Code closes it.
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, end)
  proxy.on('exit', end)
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
