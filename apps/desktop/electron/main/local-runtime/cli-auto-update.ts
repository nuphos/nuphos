// A computer that runs the `nuphos` CLI (a server, or a computer from Nuphos) keeps its Nuphos
// current itself, the way the Desktop does (auto-update.ts): when a newer CLI is out, on unless
// whoever manages the computer turned it off, and only once no task has run on it for a while.
// `nuphos update` installs the release and restarts the service the host runs under.
//
// Runtime imports stay free of Electron so this loads under plain `node --test`.

import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import {
  AUTO_INSTALL_IDLE_SECONDS,
  DEFAULT_AUTO_INSTALL,
  idleThreshold,
  parseAutoInstall,
  shouldAutoInstall,
} from '../auto-update.ts'

import { RuntimeTaskActivity } from './sleep-prevention.ts'

import type { AutoInstallPreferences } from '../auto-update.ts'

export const CLI_UPDATE_CHECK_MS = 15 * 60_000

/** Where the switch and the last release it went for are kept: the agent home. */
export function autoInstallFiles(home: string) {
  return {
    preferences: path.join(home, 'auto-update.json'),
    tried: path.join(home, 'auto-update-tried'),
  }
}

export function readCliAutoInstall(home: string): AutoInstallPreferences {
  try {
    return parseAutoInstall(JSON.parse(readFileSync(autoInstallFiles(home).preferences, 'utf8')))
  } catch {
    return { ...DEFAULT_AUTO_INSTALL }
  }
}

/** Whether `candidate` is a newer `major.minor.patch` than `current`. */
export function newerRelease(candidate: string, current: string): boolean {
  const release = /^\d+\.\d+\.\d+$/u

  if (!release.test(candidate) || !release.test(current)) return false
  const [a, b] = [candidate, current].map((v) => v.split('.').map(Number))

  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return (a[i] ?? 0) > (b[i] ?? 0)

  return false
}

/**
 * The time since a task last ran here, from the task activity the tunnel reports to: zero while
 * one runs, counted from when the host started before any has.
 */
export function idleClock(now = () => Date.now()) {
  let since = now()
  const activity = new RuntimeTaskActivity(() => {
    since = now()
  })

  return {
    activity,
    idleSeconds: () => (activity.busy() ? 0 : Math.floor((now() - since) / 1_000)),
  }
}

export type CliAutoUpdateDeps = {
  /** The CLI this host runs (`NUPHOS_CLI_VERSION`). */
  version: string
  home: string
  latest: () => Promise<string | null>
  busy: () => boolean
  idleSeconds: () => number
  /** Seconds without a task before it updates (idleThreshold: NUPHOS_AUTO_UPDATE_IDLE_SECONDS). */
  idleThreshold?: number
  /** Starts `nuphos update`; false when it could not start. */
  update: () => Promise<boolean>
}

/** One check: starts `nuphos update` and returns the release when it is time to. */
export async function checkCliUpdate(deps: CliAutoUpdateDeps): Promise<string | null> {
  const latest = await deps.latest().catch(() => null)

  if (!latest) return null
  const { tried } = autoInstallFiles(deps.home)
  // An update to this release ran and the host came back on the old one: retrying alone could loop.
  const failedBefore = readTried(tried) === latest
  const due = shouldAutoInstall(
    {
      enabled: readCliAutoInstall(deps.home).enabled,
      ready: newerRelease(latest, deps.version),
      failedBefore,
      busy: deps.busy(),
      idleSeconds: deps.idleSeconds(),
    },
    deps.idleThreshold ?? AUTO_INSTALL_IDLE_SECONDS,
  )

  // Noted once it started, so a release whose update could not even start is tried again.
  if (!due || !(await deps.update())) return null
  writeFileSync(tried, latest)

  return latest
}

/** A check on the timer: whatever goes wrong is logged, never thrown at the host. */
export function tickCliUpdate(deps: CliAutoUpdateDeps): Promise<string | null> {
  return checkCliUpdate(deps).catch((error: unknown) => {
    console.error(`Could not check for a Nuphos update: ${String(error)}`)

    return null
  })
}

function readTried(file: string): string {
  try {
    return readFileSync(file, 'utf8').trim()
  } catch {
    return ''
  }
}

/** The newest CLI release, as `nuphos update` asks for it. */
export async function latestCliRelease(apiUrl: string): Promise<string | null> {
  const response = await fetch(new URL('/cli/latest', apiUrl), {
    signal: AbortSignal.timeout(5_000),
  })

  return response.ok ? (await response.text()).trim() || null : null
}

/** `nuphos update`, apart from this host: the restart it ends with stops the host. */
export function runCliUpdate(exe: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(exe, ['update'], { detached: true, stdio: 'ignore' })

    child.once('error', () => {
      resolve(false)
    })
    child.once('spawn', () => {
      child.unref()
      resolve(true)
    })
  })
}

/** `NUPHOS_AUTO_UPDATE_CHECK_SECONDS` checks sooner for testing; never more often than 5 s. */
export function checkInterval(env: NodeJS.ProcessEnv): number {
  const seconds = Number(env.NUPHOS_AUTO_UPDATE_CHECK_SECONDS)

  return Number.isFinite(seconds) && seconds > 0
    ? Math.max(5, Math.floor(seconds)) * 1_000
    : CLI_UPDATE_CHECK_MS
}

export function startCliAutoUpdate(
  deps: CliAutoUpdateDeps,
  every = CLI_UPDATE_CHECK_MS,
): () => void {
  const timer = setInterval(() => void tickCliUpdate(deps), every)

  timer.unref()

  return () => {
    clearInterval(timer)
  }
}

/**
 * The switch, changed from the computer's card (`method: 'autoInstall'`); every other request goes
 * to `handle`. `write` keeps it where this computer reads it.
 */
export function withAutoInstallRequest(
  handle: ((request: unknown) => Promise<unknown>) | undefined,
  write: (value: unknown) => AutoInstallPreferences,
  /** The status changed: the card shows the switch as it now is. */
  changed?: () => void,
): (request: unknown) => Promise<unknown> {
  return (request) => {
    const { method, enabled } = (request ?? {}) as { method?: unknown; enabled?: unknown }

    if (method !== 'autoInstall')
      return handle?.(request) ?? Promise.reject(new Error('Instance management unavailable'))

    try {
      const next = write({ enabled })

      changed?.()

      return Promise.resolve(next)
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }
  }
}

export function writeCliAutoInstall(home: string, value: unknown): AutoInstallPreferences {
  const next = parseAutoInstall(value)

  writeFileSync(autoInstallFiles(home).preferences, JSON.stringify(next))

  return next
}

/**
 * What the CLI host adds for it: the task activity its tunnel reports to, and the status and
 * requests the computer's card reads and changes the switch through. Checks start at once.
 */
export function cliAutoUpdate(apiUrl: () => string, changed: () => void, env = process.env) {
  const home = env.NUPHOS_AGENT_HOME
  const version = env.NUPHOS_CLI_VERSION
  // Set only when the host runs as the service, whose restart brings the update up (agent.rs).
  const exe = env.NUPHOS_CLI_EXE
  const clock = idleClock()

  if (home && version && exe)
    startCliAutoUpdate(
      {
        version,
        home,
        latest: () => latestCliRelease(apiUrl()),
        busy: () => clock.activity.busy(),
        idleSeconds: clock.idleSeconds,
        idleThreshold: idleThreshold(env),
        update: () => runCliUpdate(exe),
      },
      checkInterval(env),
    )

  return {
    activity: clock.activity,
    wrap: <S extends object>(
      status: () => S,
      instances?: (request: unknown) => Promise<unknown>,
    ): [() => S & { autoInstall?: boolean }, typeof instances] =>
      home
        ? [
            () => ({ ...status(), autoInstall: readCliAutoInstall(home).enabled }),
            withAutoInstallRequest(instances, (value) => writeCliAutoInstall(home, value), changed),
          ]
        : [status, instances],
  }
}
