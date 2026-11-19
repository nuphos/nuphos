import { runtimeVersionAtLeast, stableRuntimeVersion } from './runtime-release'

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
