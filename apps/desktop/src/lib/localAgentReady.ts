import { AGENT_PROVIDER } from '../types/runtime.ts'

import type { LocalAgentProvider, LocalRuntimeState } from '../api/device-types.ts'
import type { RuntimeInstance } from '../types/runtime.ts'

/** Whether this computer has an agent CLI installed and signed in; null while still checking. */
export function localAgentReady(state: LocalRuntimeState | null): boolean | null {
  if (!state?.userId) return null
  const agents = Object.values(state.agents).filter((agent) => agent.available)

  if (agents.some((agent) => agent.cli === null)) return null

  return agents.some((agent) => agent.cli?.installed && agent.cli.loggedIn === true)
}

/** Must match `localRuntimeId` in the backend. */
export function localAgentId(
  userId: string,
  deviceId: string,
  provider: LocalAgentProvider,
): string {
  const id = `local_${userId}_${deviceId}`

  return provider === 'codex' ? `${id}_codex` : id
}

/**
 * This computer's signed-in agents the team catalog does not list yet, known
 * from the desktop itself so the picker never waits on the backend to show them.
 */
export function pendingLocalAgents(
  state: LocalRuntimeState | null,
  listed: readonly { id: string }[],
): RuntimeInstance[] {
  const userId = state?.userId
  const deviceId = state?.deviceId

  if (!state || !userId || !deviceId) return []
  const known = new Set(listed.map((instance) => instance.id))

  return (Object.keys(state.agents) as LocalAgentProvider[]).flatMap((provider) => {
    const { available, cli } = state.agents[provider]
    const id = localAgentId(userId, deviceId, provider)

    if (
      !available ||
      !cli?.installed ||
      (provider !== 'claude-code' && cli.loggedIn !== true) ||
      known.has(id)
    )
      return []

    return [
      {
        id,
        provider,
        label: `This computer · ${AGENT_PROVIDER[provider].label}`,
        status: 'active' as const,
        kind: 'local' as const,
        createdAt: '',
        starting: true,
        local: {
          ownerUserId: userId,
          deviceId,
          deviceLabel: 'This computer',
          signedIn: cli.loggedIn,
        },
      },
    ]
  })
}
