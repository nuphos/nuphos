import { api } from '../../api'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

import { openComputerScreen } from './boxDesktop'

/** Opens the screen of the viewer's own computer through its runtime's tunnel, as the iPhone opens it. */
export function openDesktop(deviceId: string, teamId: string, runtimeId: string): void {
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
