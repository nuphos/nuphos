import { t } from '../../../i18n/index.ts'
import { usable } from '../../../lib/agentName.ts'
import { AGENT_PROVIDER } from '../../../types/runtime.ts'

import type { RuntimeControl } from './RuntimeSelector'
import type { RuntimeInstance } from '../../../types/runtime.ts'

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
    agent: local.accountLabel ?? local.agentLabel ?? AGENT_PROVIDER[value.provider].label,
    computer: local.deviceLabel,
  })
}

/** The conversation's own agent is disabled or no longer in the workspace. */
export function runtimeGone(control: RuntimeControl | undefined): control is RuntimeControl {
  return Boolean(control?.unavailable && control.value?.id)
}

/** What the banner and the send button say about a gone agent. */
export function runtimeGoneText(control: Pick<RuntimeControl, 'value'>): string {
  return t('{name} is no longer available.', { name: control.value?.label ?? t('The runtime') })
}

/** Why the next message cannot go, or null when it can: no agent, or one that cannot take it. */
export function runtimeControlSendBlock(control: RuntimeControl | undefined): string | null {
  if (control?.onSelect && (!control.value || control.value.status === 'disabled'))
    return t('Choose a runtime to send')
  // Its agent was removed: a message would only come back as runtime_not_found.
  if (runtimeGone(control))
    return control.onSelect ? t('Choose a runtime to send') : runtimeGoneText(control)
  const reachability = selectedAgentReachability(control)

  if (reachability === 'offline') return t('Its computer is offline')
  if (reachability === 'signIn') return t('The runtime needs to sign in')

  return null
}

/**
 * No agent a new conversation could start on (none, or only signed-out, offline
 * or deleting ones), so sending can only mean setting one up. Unknown while the
 * list loads or fails: never claimed then.
 */
export function noAgentToRun(
  instances: readonly RuntimeInstance[],
  loading: boolean,
  error: string | null,
): boolean {
  return !loading && !error && !instances.some((i) => usable(i) && !i.deletion)
}
