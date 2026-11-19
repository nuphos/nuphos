import { t } from '../../i18n/index.ts'

import type { RuntimeStatusView } from './runtimePresentation'
import type { LocalRuntimeState } from '../../api/device-types'

const BADGE: Record<NonNullable<LocalRuntimeState['connection']>, RuntimeStatusView> = {
  online: { label: t('Running'), tone: 'online' },
  reconnecting: { label: t('Reconnecting…'), tone: 'pending' },
  superseded: { label: t('In use by another app'), tone: 'off' },
  revoked: { label: t('Access removed'), tone: 'error' },
}

/**
 * This computer's status from its own connection rather than the backend's last sighting: the
 * app knows first, and knows why it is not connected. Undefined until it has said.
 */
export function thisComputerBadge(
  connection: LocalRuntimeState['connection'],
): RuntimeStatusView | undefined {
  return connection && BADGE[connection]
}
