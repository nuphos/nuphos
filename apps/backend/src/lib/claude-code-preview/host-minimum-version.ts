import {
  latestCliRelease,
  newerRuntimeVersion,
  runtimeVersionAtLeast,
  stableRuntimeVersion,
} from './runtime-release'

import type { RuntimeRelease } from './runtime-release'
import type { LocalRuntimePresence } from '@/lib/agent/devices/local-runtime/presence'

/**
 * The oldest Nuphos a computer should run. Below it, its card and chats say it is out of date
 * and how to update; nothing refuses its turns. Desktop 0.127.0 is the first that installs a
 * downloaded update by itself while idle, so an older one stays behind until someone restarts
 * it (#3829). CLI 0.20.0 is the first that bundles runtime 0.1.62; before it, the first message
 * of every new conversation fails with "Session not found".
 */
export const MINIMUM_HOST_VERSION = { desktop: '0.127.0', cli: '0.20.0' } as const

export type OutdatedHost = keyof typeof MINIMUM_HOST_VERSION

const APP: Record<string, OutdatedHost> = { 'nuphos-desktop': 'desktop', 'nuphos-cli': 'cli' }

/**
 * Which Nuphos on a computer is older than the floor: what its host reports about itself, else
 * the app it connected as (`nuphos-desktop/0.119.2`). A dev build or a host that names no
 * version is unknown, and an unknown host is never called out of date.
 */
export function hostOutdated(
  presence: Pick<LocalRuntimePresence, 'client' | 'status'> | null,
): OutdatedHost | undefined {
  const [app = '', version] = presence?.client?.split('/') ?? []
  const running: Partial<Record<OutdatedHost, string>> = {
    ...(app in APP ? { [APP[app] ?? 'cli']: version } : {}),
    ...(presence?.status?.cliVersion ? { cli: presence.status.cliVersion } : {}),
    ...(presence?.status?.app ? { desktop: presence.status.app.version } : {}),
  }

  return (Object.keys(MINIMUM_HOST_VERSION) as OutdatedHost[]).find((host) => {
    const reported = running[host]

    return (
      stableRuntimeVersion(reported) && !runtimeVersionAtLeast(reported, MINIMUM_HOST_VERSION[host])
    )
  })
}

/**
 * Whether a newer Nuphos than the one on a computer is out: for a Desktop, the update its own
 * updater found; for a CLI host, the newest CLI release. A Desktop whose updater has not found
 * one yet counts as current.
 */
export async function updateAvailable(
  presence: Pick<LocalRuntimePresence, 'client' | 'status'> | null,
  latestCli: () => Promise<RuntimeRelease | null> = latestCliRelease,
): Promise<boolean> {
  const app = presence?.status?.app

  if (app) return Boolean(app.update && newerRuntimeVersion(app.update.version, app.version))
  const [name, connectedAs] = presence?.client?.split('/') ?? []
  const cli = presence?.status?.cliVersion ?? (name === 'nuphos-cli' ? connectedAs : undefined)

  if (!stableRuntimeVersion(cli)) return false
  const latest = await latestCli()

  return Boolean(latest && newerRuntimeVersion(latest.version, cli))
}

/** What a failed turn adds when the computer that ran it is out of date. */
export const OUTDATED_HOST_HINT =
  'Nuphos on this computer is out of date. Update it there, then try again.'

export const DESKTOP_UPDATE_READY_HINT =
  'Nuphos Desktop on the computer running this agent is out of date. The downloaded update is ready. Quit Nuphos fully (⌘Q on a Mac) and reopen it to install it. If it stays in the Dock, quit it again.'
export const DESKTOP_OUTDATED_HINT =
  'Nuphos Desktop on the computer running this agent is out of date. Open Settings → Updates to get the update, then quit Nuphos fully (⌘Q on a Mac) and reopen it. If it stays in the Dock, quit it again.'

const HOST_LABEL_MAX = 80

/** Only claim a download is ready when the Desktop has reported it staged. */
export async function hostUpdateHint(
  presence: Pick<LocalRuntimePresence, 'client' | 'status'> | null,
  label?: string,
): Promise<string | undefined> {
  if (!hostOutdated(presence) && !(await updateAvailable(presence))) return
  const app = presence?.status?.app

  if (!app && !presence?.client?.startsWith('nuphos-desktop/')) return OUTDATED_HOST_HINT

  const hint =
    app?.update?.ready && newerRuntimeVersion(app.update.version, app.version)
      ? DESKTOP_UPDATE_READY_HINT
      : DESKTOP_OUTDATED_HINT

  // The label is user-set and travels into a Bot's reason: one short line, inserted literally.
  const host = label?.replace(/\s+/gu, ' ').trim().slice(0, HOST_LABEL_MAX)

  return host ? hint.replace('the computer running this agent', () => host) : hint
}

/** Preserve only the known product sentence, never the underlying runtime error. */
export function outdatedHint(error: unknown): string | undefined {
  if (!(error instanceof Error)) return

  if (error.message.endsWith(OUTDATED_HOST_HINT)) return OUTDATED_HOST_HINT
  const hint = error.message.match(
    /Nuphos Desktop on [^\n]{1,120} is out of date\. [^\n]{1,200}$/u,
  )?.[0]

  return hint &&
    [DESKTOP_UPDATE_READY_HINT, DESKTOP_OUTDATED_HINT].some((known) =>
      hint.endsWith(known.slice(known.indexOf(' is out of date.'))),
    )
    ? hint
    : undefined
}

/** A Bot's plain reason may already include the hint when it came from an AppError. */
export function withOutdatedHint(message: string | undefined, error: unknown): string | undefined {
  const hint = outdatedHint(error)

  return hint && !message?.endsWith(hint) ? [message, hint].filter(Boolean).join(' ') : message
}
