// A desktop per conversation on a Linux computer: the agents' env names the wrapper
// Claude runs as each session's `nuphos-desktop` MCP server (desktop-session.mjs),
// and a pool sized to the CPUs; a reaper frees displays whose session is gone.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, watch } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const REAP_EVERY_MS = 60_000

export type SessionDesktop = { display: number; sessionId: string }

/** The desktops sessions hold right now, as the wrapper lists them from its lock files. */
export function listDesktops(wrapper: string, pool: string): SessionDesktop[] {
  const out = spawnSync(process.execPath, [wrapper, 'list', pool], {
    encoding: 'utf8',
    timeout: 5_000,
  })

  try {
    const parsed = JSON.parse(out.stdout) as { display: number; sessionId: string }[]

    return parsed.map(({ display, sessionId }) => ({ display, sessionId }))
  } catch {
    return []
  }
}

/** The computer-use proxy forgets a human owner this long after their last renewal (vnc-stream.ts). */
const HUMAN_HOLD_MS = 30_000

export const HELD =
  'A person has taken over this conversation’s desktop, so the browser waits too. Do not retry now: end your turn, and continue when you are told they handed it back.'

/**
 * Whether a person holds one of `sessionId`'s displays right now, read from the
 * control file the desktop stream renews while they do (vnc-stream.ts). The
 * session's other input, its headless browser, waits for them as its desktop does.
 */
export function humanHolds(pool: string, sessionId: string, now = Date.now()): boolean {
  const read = (file: string) => {
    try {
      return readFileSync(path.join(pool, file), 'utf8')
    } catch {
      return ''
    }
  }
  const lockedBy = (lock: string) => {
    try {
      return (JSON.parse(read(lock)) as { sessionId?: string }).sessionId
    } catch {
      return
    }
  }

  return (existsSync(pool) ? readdirSync(pool) : []).some((name) => {
    if (!name.endsWith('.lock') || lockedBy(name) !== sessionId) return false
    const [owner, , since] = read(`${name.slice(0, -5)}.xdg/instabox-control`)
      .trim()
      .split(' ')

    return owner === 'human' && now - Number(since) * 1000 < HUMAN_HOLD_MS
  })
}

/** What the tunnel status says about this computer's desktops: who holds which, and that it opens them on request. */
export function desktopStatus(wrapper: string, pool: string) {
  return { desktops: listDesktops(wrapper, pool), desktopOpen: true }
}

/** Opens a desktop for `sessionId` by hand, held by this host; the session's own when it has one. */
export function openDesktop(wrapper: string, pool: string, sessionId: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [wrapper, 'open', pool, sessionId, String(process.pid)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''

    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      err += chunk.toString()
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      const display = Number(out.trim())

      if (code === 0 && Number.isInteger(display)) resolve(display)
      else reject(new Error(/Error: (.+)/u.exec(err)?.[1] ?? 'The desktop did not start'))
    })
  })
}

/** The backend's one-shot requests: agent instances, and a desktop the owner opens by hand. */
export function withDesktopRequests(
  open: (sessionId: string) => Promise<number>,
  instances?: (request: unknown) => Promise<unknown>,
): (request: unknown) => Promise<unknown> {
  return (request) => {
    const { method, sessionId } = (request ?? {}) as { method?: unknown; sessionId?: unknown }

    if (method !== 'desktop')
      return instances?.(request) ?? Promise.reject(new Error('Instance management unavailable'))
    if (typeof sessionId !== 'string' || !sessionId)
      return Promise.reject(new Error('A desktop needs its session'))

    return open(sessionId).then((display) => ({ display }))
  }
}

/** What desktop-session.mjs runs on each display, and what to install for it. */
const DESKTOP_NEEDS = {
  Xvnc: 'tigervnc-standalone-server',
  'xfce4-session': 'xfce4',
  'open-computer-use': 'npm install -g open-computer-use',
}

/** What this computer lacks, of DESKTOP_NEEDS, to host desktops. */
export function missingForDesktops(PATH = process.env.PATH ?? ''): string[] {
  const dirs = PATH.split(path.delimiter).filter(Boolean)

  return Object.entries(DESKTOP_NEEDS)
    .filter(([command]) => !dirs.some((dir) => existsSync(path.join(dir, command))))
    .map(([, install]) => install)
}

/** Returns the pool directory, or null where this computer cannot host desktops. */
// TODO(team Box): a Box shared by a team runs every session as the same OS user,
// so this pool must stay off there until sessions get Unix users of their own.
export function enableDesktopPool(bundleRoot: string, dataDir: string): string | null {
  const wrapper = path.join(bundleRoot, 'desktop-session.mjs')

  if (process.platform !== 'linux' || !existsSync(wrapper)) return null
  const missing = missingForDesktops()

  if (missing.length > 0) {
    console.log(
      `To hand this computer's screen to you for a sign-in, install: ${missing.join(', ')}.`,
    )

    return null
  }
  const pool = path.join(dataDir, 'desktops')

  process.env.NUPHOS_DESKTOP_SESSION = wrapper
  process.env.NUPHOS_DESKTOP_POOL = pool
  process.env.NUPHOS_DESKTOP_POOL_SIZE = String(os.cpus().length)
  setInterval(() => {
    spawn(process.execPath, [wrapper, 'reap', pool], { stdio: 'ignore' }).on('error', () => {})
  }, REAP_EVERY_MS).unref()

  return pool
}

/** Calls `changed` (debounced) whenever a session takes or frees a display. */
export function watchDesktops(pool: string, changed: () => void): void {
  let timer: ReturnType<typeof setTimeout> | undefined

  mkdirSync(pool, { recursive: true, mode: 0o700 })
  watch(pool, () => {
    clearTimeout(timer)
    timer = setTimeout(changed, 300)
  }).unref()
}
