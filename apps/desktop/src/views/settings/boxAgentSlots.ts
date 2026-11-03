import { t } from '../../i18n/index.ts'

import type { MachineState } from './boxPresentation'
import type { RuntimeInstance } from '../../types/runtime'

/**
 * What a machine shows in its agent row. Only a machine that is setting up or restarting is
 * "starting"; an empty list after that is just empty, never a wait that does not end. This
 * computer only lists agents once Claude Code or Codex runs locally, so its empty list asks for
 * setup.
 */
export function agentSlots(
  thisComputer: boolean,
  busy: boolean,
  state: MachineState,
  agents: readonly RuntimeInstance[],
): 'starting' | 'noLocalAgent' | 'agents' {
  if (busy) return 'starting'
  if (state !== 'running' || agents.length > 0) return 'agents'

  return thisComputer ? 'noLocalAgent' : 'agents'
}

/** Whether + (New runtime) shows: on a running machine the viewer manages, as adding agents is managing it. */
export function canAddAgent(state: MachineState, manage: boolean): boolean {
  return state === 'running' && manage
}

/** Where + would be for someone who may only use a running machine: whom to ask. */
export function askToAdd(
  state: MachineState,
  manage: boolean,
  owner: { name: string | null } | null,
): string | undefined {
  if (state !== 'running' || manage) return undefined

  return owner?.name ? t('Ask {name}', { name: owner.name }) : t('Ask the owner')
}
