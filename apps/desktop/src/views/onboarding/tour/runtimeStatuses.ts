import { LOCAL_AGENT_PROVIDERS } from '../../../api/local-agent-providers'
import { setupAgentStatus } from '../setup/agentSetup'

import type { LocalAgentProvider, LocalRuntimeState } from '../../../api'
import type { LocalAgentStatus } from '../setup/agentSetup'

/** A Box, as the Computers page draws one. */
export const BOX_MODEL = { form: 'box', brand: 'nuphos' } as const

/** The Box's flight from the dialog to its place: long enough to follow, quick to settle. */
export const FLIGHT = { duration: 0.75, ease: [0.22, 1, 0.36, 1] } as const

export type RuntimeStatuses = Record<LocalAgentProvider, LocalAgentStatus>

/** Every runtime this computer can run, as this computer last saw each. */
export function runtimeStatuses(
  state: LocalRuntimeState | null,
  scanned: readonly string[] | null,
): RuntimeStatuses {
  return Object.fromEntries(
    LOCAL_AGENT_PROVIDERS.map((provider) => [provider, setupAgentStatus(state, provider, scanned)]),
  ) as RuntimeStatuses
}

/** On this computer: signed in or not, or found by a development build's look for its tool. */
const installed = (status: LocalAgentStatus) =>
  status === 'ready' || status === 'signed-out' || status === 'found'

/** The runtimes on this computer, in the order Nuphos lists them. */
export const installedRuntimes = (statuses: RuntimeStatuses) =>
  LOCAL_AGENT_PROVIDERS.filter((provider) => installed(statuses[provider]))
