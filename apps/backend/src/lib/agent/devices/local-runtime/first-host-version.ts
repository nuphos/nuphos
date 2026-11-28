import type { LocalRuntimePresence } from './presence'
import type { LocalAgentProvider } from './protocol'

import {
  runtimeVersionAtLeast,
  stableRuntimeVersion,
} from '@/lib/claude-code-preview/runtime-release'

/** The first Nuphos that knows an agent added after the rest. An older host refuses it as an
 *  invalid instance, which says nothing about updating (#5082). */
const FIRST_HOST: Partial<Record<LocalAgentProvider, { desktop: string; cli: string }>> = {
  cursor: { desktop: '0.137.0', cli: '0.30.0' },
}

const below = (running: string | undefined, floor: string) =>
  stableRuntimeVersion(running) && !runtimeVersionAtLeast(running, floor)

/** Whether the host reports a version older than the first that knows `provider`; an unknown
 *  version (a dev build) is never too old. */
export function tooOldFor(
  presence: Pick<LocalRuntimePresence, 'client' | 'status'>,
  provider: LocalAgentProvider,
): boolean {
  const first = FIRST_HOST[provider]

  if (!first) return false
  const [app, version] = presence.client?.split('/') ?? []
  const desktop = presence.status?.app?.version ?? (app === 'nuphos-desktop' ? version : undefined)
  const cli = presence.status?.cliVersion ?? (app === 'nuphos-cli' ? version : undefined)

  return below(desktop, first.desktop) || below(cli, first.cli)
}
