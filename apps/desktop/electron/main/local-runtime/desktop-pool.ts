// A desktop per conversation on a Linux Box: the agents' env names the wrapper
// Claude runs as each session's `computer-use` MCP server (desktop-session.mjs),
// and a pool sized to the CPUs; a reaper frees displays whose session is gone.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, watch } from 'node:fs'
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

/** Returns the pool directory, or null where this computer cannot host desktops. */
// TODO(team Box): a Box shared by a team runs every session as the same OS user,
// so this pool must stay off there until sessions get Unix users of their own.
export function enableDesktopPool(bundleRoot: string, dataDir: string): string | null {
  const wrapper = path.join(bundleRoot, 'desktop-session.mjs')

  if (
    process.platform !== 'linux' ||
    !existsSync(wrapper) ||
    !existsSync('/usr/local/bin/open-computer-use') ||
    !['/usr/bin/Xvnc', '/usr/local/bin/Xvnc'].some((xvnc) => existsSync(xvnc))
  )
    return null
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
