import { t } from '../../i18n/index.ts'

import { BOX_BADGE } from './boxPresentation.ts'

import type { MachineState } from './boxPresentation'
import type { RuntimeStatusView } from './runtimePresentation'
import type { LocalRuntimeState } from '../../api/device-types'

type Down = Exclude<NonNullable<LocalRuntimeState['connection']>, 'online'>

const WHY_DOWN: Record<Down, RuntimeStatusView> = {
  reconnecting: { label: t('Reconnecting…'), tone: 'pending' },
  superseded: { label: t('In use by another app'), tone: 'off' },
  revoked: { label: t('Access removed'), tone: 'error' },
}

/**
 * A computer's status, from the same state its picture follows, so the two never disagree.
 * When this computer is not running, its own connection says why, never a bare Offline.
 */
export function computerBadge(
  state: MachineState,
  connection?: LocalRuntimeState['connection'],
): RuntimeStatusView {
  if (state === 'running' || !connection || connection === 'online') return BOX_BADGE[state]

  return WHY_DOWN[connection]
}
