import { quotaSignedOut } from '../../../lib/runtimeQuota.ts'

import type { RuntimeControl } from './RuntimeSelector'

/** Whether the picked agent can take a message now: its Box first, then its sign-in. */
export type AgentReachability = 'ready' | 'signIn' | 'offline'

/**
 * One answer for the dot, the banner and the send button. Agents without a Box have no dot.
 * Signed out is only what is certain: the Box host's own report, or the usage probe of a
 * managed agent. Any other agent may carry a token the probe cannot see, so its probe never
 * stops a message.
 */
export function selectedAgentReachability(
  control: Pick<RuntimeControl, 'value' | 'options' | 'quotas'> | undefined,
): AgentReachability | null {
  const id = control?.value?.id

  if (!id) return null
  const instance = control.options?.find((option) => option.id === id)
  const local = instance?.local

  if (local?.online === false) return 'offline'
  if (
    local?.signedIn === false ||
    (instance?.kind === 'managed' && quotaSignedOut(control.quotas?.get(id)))
  )
    return 'signIn'

  return local ? 'ready' : null
}

/** Why the next message cannot go, or null when it can: no agent, or one that cannot take it. */
export function runtimeControlSendBlock(control: RuntimeControl | undefined): string | null {
  if (control?.onSelect && (!control.value || control.value.status === 'disabled'))
    return 'Choose an agent to send'
  const reachability = selectedAgentReachability(control)

  if (reachability === 'offline') return 'Its Box is offline'
  if (reachability === 'signIn') return 'The agent needs to sign in'

  return null
}
