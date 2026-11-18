import type { BotPresence } from '../../api/agent-types'
import type { RuntimeInstance } from '../../types/runtime'

/**
 * The Bot's runtime as its presence has it (#3308): a computer the server finds offline or
 * signed out reads so here too, so the composer's existing strip and send block show it.
 */
export function withBotPresence(
  instances: RuntimeInstance[],
  runtimeId: string | undefined,
  presence: BotPresence | undefined,
): RuntimeInstance[] {
  const reason = presence?.state === 'offline' ? presence.reason : undefined
  const patch =
    reason === 'computer_offline'
      ? { online: false }
      : reason === 'sign_in_required'
        ? { signedIn: false }
        : null

  if (!patch || !runtimeId) return instances

  return instances.map((instance) =>
    instance.id === runtimeId && instance.local
      ? { ...instance, local: { ...instance.local, ...patch } }
      : instance,
  )
}
