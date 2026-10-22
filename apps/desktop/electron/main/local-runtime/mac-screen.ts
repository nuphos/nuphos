// A Mac's own screen as a conversation's desktop. Screen Sharing (System
// Settings › General › Sharing) serves it over VNC on port 5900, which is
// display 0 to vnc-stream.ts, and asks the viewer for a Mac account, so only
// someone who could sign in at the Mac sees it. There is one screen, so one
// conversation holds it at a time. Its lock names that session the way a Box's
// pool does (desktop-session.mjs), and the stream touches it every minute while
// someone watches. Another conversation gets the screen only once nobody has
// watched it for IDLE_MS, when the lock is freed; a stream whose lock went to
// another session ends (vnc-stream.ts). Unlike a Box, nothing pauses the agent's
// input tools here while the owner has the screen.

import { readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import path from 'node:path'

import { watchDesktops, withDesktopRequests } from './desktop-pool.ts'
import { VncStream } from './vnc-stream.ts'

import type { LocalRuntimeTunnelStatus } from './tunnel-protocol.ts'

const SCREEN = 0
const SCREEN_SHARING_PORT = 5900
const PROBE_MS = 2_000
/** Three missed touches from vnc-stream.ts: nobody watches. */
const IDLE_MS = 3 * 60_000

const lockFile = (pool: string) => path.join(pool, `${String(SCREEN)}.lock`)

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

function listening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1')
    const done = (on: boolean) => {
      socket.destroy()
      resolve(on)
    }

    socket.setTimeout(PROBE_MS, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

/** Hands the screen to `sessionId`, once Screen Sharing is on and no other conversation watches it. */
export async function openMacScreen(
  pool: string,
  sessionId: string,
  port = SCREEN_SHARING_PORT,
): Promise<number> {
  if (!(await listening(port)))
    throw new Error(
      'Turn on Screen Sharing in System Settings › General › Sharing to show this Mac’s screen.',
    )
  // Checked after the probe, with nothing awaited before the write: two opens cannot both win.
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
  instances?: (request: unknown) => Promise<unknown>,
) {
  return {
    instances: withDesktopRequests((sessionId) => openMacScreen(pool, sessionId), instances),
    connectVnc: () => new VncStream(pool),
    status: () => ({ ...status(), ...macScreenStatus(pool) }),
  }
}
