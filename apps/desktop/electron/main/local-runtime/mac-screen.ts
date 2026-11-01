// A Mac's own screen as a conversation's desktop. The bundle's mac-screen-host
// serves it as display 0 on a unix socket in the pool: ScreenCaptureKit and
// VideoToolbox H.264 over RFB with security None, so no Mac account is asked
// for; only the Mac's owner reaches it, through the authenticated relay, and
// the stream also refuses any viewer who is not the account signed in here. The
// host takes connections only from this process, exits a minute
// after its last viewer leaves or as soon as this process does, and opening the
// screen starts it again. It needs Screen Recording and Accessibility for
// Nuphos. There is one screen, so one conversation holds it at a time. Its lock names that session
// the way a Box's pool does (desktop-session.mjs), and the stream touches it
// every minute while someone watches. Another conversation gets the screen only
// once nobody has watched it for IDLE_MS, when the lock is freed; a stream
// whose lock went to another session ends (vnc-stream.ts). Unlike a Box,
// nothing pauses the agent's input tools here while the owner has the screen.

import { spawn } from 'node:child_process'
import { readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import path from 'node:path'

import { watchDesktops, withDesktopRequests } from './desktop-pool.ts'
import { VncStream } from './vnc-stream.ts'

import type { ChildProcess } from 'node:child_process'
import type { LocalRuntimeTunnelStatus } from './tunnel-protocol.ts'

const SCREEN = 0
const START_MS = 5_000
/** Three missed touches from vnc-stream.ts: nobody watches. */
const IDLE_MS = 3 * 60_000

const lockFile = (pool: string) => path.join(pool, `${String(SCREEN)}.lock`)

export const screenSocket = (pool: string) => path.join(pool, `${String(SCREEN)}.sock`)

/**
 * The pool directory for this Mac's screen, or null on any other platform.
 * `changed` runs when the screen changes hands or goes idle.
 */
export function enableMacScreen(
  dataDir: string,
  changed: () => void,
  platform = process.platform,
): string | null {
  if (platform !== 'darwin') return null
  const pool = path.join(dataDir, 'desktops')

  watchDesktops(pool, changed)
  // Frees an idle lock; the watcher then reports the screen gone.
  setInterval(() => holder(pool), 60_000).unref()

  return pool
}

/** The session holding the screen; a lock nobody has watched for IDLE_MS is freed. */
function holder(pool: string, now = Date.now()): string | undefined {
  try {
    if (now - statSync(lockFile(pool)).mtimeMs > IDLE_MS) {
      rmSync(lockFile(pool), { force: true })

      return undefined
    }

    return (JSON.parse(readFileSync(lockFile(pool), 'utf8')) as { sessionId?: string }).sessionId
  } catch {
    return undefined
  }
}

/** What the tunnel status says: the session holding the screen, and that it opens on request. */
export function macScreenStatus(pool: string, now = Date.now()) {
  const sessionId = holder(pool, now)

  return { desktops: sessionId ? [{ display: SCREEN, sessionId }] : [], desktopOpen: true }
}

function listening(socket: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = connect(socket)
    const done = (on: boolean) => {
      probe.destroy()
      resolve(on)
    }

    probe.once('connect', () => done(true))
    probe.once('error', () => done(false))
  })
}

let host: ChildProcess | undefined

/** Starts the bundle's host for this screen unless one already listens; rejects with its reason. */
export async function startHost(pool: string, binary: string): Promise<void> {
  const socket = screenSocket(pool)

  if (await listening(socket)) return
  host?.kill()
  const child = spawn(binary, [socket], { stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''

  host = child
  const collect = (chunk: Buffer) => {
    output += chunk.toString()
  }

  child.stdout?.on('data', collect)
  child.stderr?.on('data', collect)
  await new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(
      () => finish(new Error('This Mac’s screen did not start in time.')),
      START_MS,
    )
    const exited = () =>
      finish(
        new Error(
          output.replace(/^mac-screen-host: /mu, '').trim() || 'This Mac’s screen could not start.',
        ),
      )
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      child.off('exit', exited)
      if (error) reject(error)
      else resolve()
    }
    const poll = () => {
      if (!settled) void listening(socket).then((on) => (on ? finish() : setTimeout(poll, 100)))
    }

    child.once('exit', exited)
    child.once('error', (error) => finish(error))
    poll()
  })
}

/** Stops the host this process started, when the app quits. */
export function stopHost(): void {
  host?.kill()
  host = undefined
}

process.once('exit', stopHost)

/** Hands the screen to `sessionId` once its host runs and no other conversation watches it. */
export async function openMacScreen(
  pool: string,
  sessionId: string,
  start: () => Promise<void>,
): Promise<number> {
  await start()
  // Checked after starting, with nothing awaited before the write: two opens cannot both win.
  const held = holder(pool)

  if (held && held !== sessionId)
    throw new Error('This Mac’s screen is open in another agent. Close it there first.')
  writeFileSync(lockFile(pool), JSON.stringify({ sessionId, since: Date.now() }), { mode: 0o600 })

  return SCREEN
}

/** The tunnel's deps that show this Mac's screen: its stream, its open request, and its status. */
export function macScreenDeps(
  pool: string,
  status: () => LocalRuntimeTunnelStatus,
  host: {
    binary: () => string
    /** A viewer took the screen over (true) or handed it back (false): the Mac says so on screen. */
    handOver: (human: boolean) => void
    /** The account signed in on this Mac: the only viewer its screen admits. */
    owner: () => string | null
  },
  instances?: (request: unknown) => Promise<unknown>,
) {
  return {
    instances: withDesktopRequests(
      (sessionId) => openMacScreen(pool, sessionId, () => startHost(pool, host.binary())),
      instances,
    ),
    connectVnc: () => new VncStream(pool, () => screenSocket(pool), host.handOver, host.owner),
    status: () => ({ ...status(), ...macScreenStatus(pool) }),
  }
}
