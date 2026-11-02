import { t } from '../../../i18n/index.ts'
import { AGENT_PROVIDER } from '../../../types/runtime.ts'

import type { RuntimeControl } from './RuntimeSelector'

/** Whether the picked agent can take a message now: its Box first, then its sign-in. */
export type AgentReachability = 'ready' | 'signIn' | 'offline'

/**
 * One answer for the dot, the banner and the send button. Agents without a Box have no dot.
 * Signed out is only the agent CLI's own status, as its Box reports it; the usage probe's
 * sign-in hint is a guess (it cannot see a token in the environment), so it never counts.
 */
export function selectedAgentReachability(
  control: Pick<RuntimeControl, 'value' | 'options'> | undefined,
): AgentReachability | null {
  const id = control?.value?.id

  if (!id) return null
  const local = control.options?.find((instance) => instance.id === id)?.local

  if (local?.online === false) return 'offline'
  if (local?.signedIn === false) return 'signIn'

  return local ? 'ready' : null
}

/** The agent, never just its computer: it is "Claude Code on Sam’s MacBook" that signs out. */
export function selectedAgentName(control: Pick<RuntimeControl, 'value' | 'options'>): string {
  const { value } = control
  const local = control.options?.find((instance) => instance.id === value?.id)?.local

  if (!value) return t('The runtime')
  if (!local) return value.label

  return t('{agent} on {computer}', {
    agent: local.agentLabel ?? AGENT_PROVIDER[value.provider].label,
    computer: local.deviceLabel,
  })
}

/** Why the next message cannot go, or null when it can: no agent, or one that cannot take it. */
export function runtimeControlSendBlock(control: RuntimeControl | undefined): string | null {
  if (control?.onSelect && (!control.value || control.value.status === 'disabled'))
    return t('Choose a runtime to send')
  const reachability = selectedAgentReachability(control)

  if (reachability === 'offline') return t('Its computer is offline')
  if (reachability === 'signIn') return t('The runtime needs to sign in')

  return null
}
