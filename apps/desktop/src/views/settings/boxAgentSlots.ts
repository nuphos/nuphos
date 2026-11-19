import { t } from '../../i18n/index.ts'

import type { MachineState } from './boxPresentation'

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
