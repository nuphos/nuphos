import { agentSignOut } from '../../../lib/runtimeQuota'

import type { RuntimeControl } from './RuntimeSelector'

/** How the selected agent's sign-in bears on the next message. */
export function selectedAgentSignOut(control: RuntimeControl | undefined) {
  const id = control?.value?.id

  if (!id) return null

  return agentSignOut(
    control.options?.find((instance) => instance.id === id),
    control.quotas?.get(id),
  )
}

/** No agent to send to: none picked, disabled, or one certain to refuse the turn. */
export function runtimeControlBlocksSend(control: RuntimeControl | undefined): boolean {
  if (control?.onSelect && (!control.value || control.value.status === 'disabled')) return true

  return selectedAgentSignOut(control) === 'blocked'
}
