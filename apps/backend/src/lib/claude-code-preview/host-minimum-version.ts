import {
  latestCliRelease,
  newerRuntimeVersion,
  runtimeVersionAtLeast,
  stableRuntimeVersion,
} from './runtime-release'

import type { RuntimeRelease } from './runtime-release'
import type { LocalRuntimePresence } from '@/lib/agent/devices/local-runtime/presence'

/**
 * The oldest Nuphos a computer may run: the first Desktop and CLI that bundle runtime 0.1.62,
 * which opens a new session when its agent lost one. On the runtime before it (0.1.57) the first
 * message of every new conversation fails with "Session not found". Raise both together
 * whenever an older host can no longer run a conversation.
 */
export const MINIMUM_HOST_VERSION = { desktop: '0.124.0', cli: '0.20.0' } as const

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
  'Nuphos on the computer running this agent is out of date. Update it there, then try again.'
