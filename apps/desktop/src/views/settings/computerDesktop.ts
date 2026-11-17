import { api } from '../../api'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

import { openBoxDesktop, openComputerScreen } from './boxDesktop'

/**
 * Opens a running Box's desktop, or with `runtimeId` the screen of the viewer's own computer
 * through that runtime's tunnel, as the iPhone opens it.
 */
export function openDesktop(deviceId: string, teamId: string, runtimeId?: string): void {
  if (!runtimeId) return openBoxDesktop(deviceId, teamId)
  const sessionId = `runtime/${runtimeId}`

  api
    .openSessionDesktop(teamId, sessionId)
    .then(({ display }) => openComputerScreen(deviceId, teamId, sessionId, display))
    // The computer's own reason when it gave one, such as a Mac without Accessibility; never nothing.
    .catch((error: unknown) =>
      toast.apiError(t('Could not open the desktop'), error, {
        fallback: t('Check your connection and try again.'),
      }),
    )
}
