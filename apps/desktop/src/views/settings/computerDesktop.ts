import { api } from '../../api'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

import { openBoxDesktop, openComputerScreen } from './boxDesktop'

/**
 * Opens a computer's screen through its runtime's tunnel, as the iPhone opens it. A Box
 * opens as its own tab, which resolves that screen and switches to its sessions' displays.
 */
export function openDesktop(
  deviceId: string,
  teamId: string,
  runtimeId: string,
  box = false,
): void {
  if (box) return openBoxDesktop(deviceId, teamId)
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
