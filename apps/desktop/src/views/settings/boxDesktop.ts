import { api } from '../../api'
import { openInApp } from '../../app/workspace/openInApp.ts'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'
import { emptyNavigation, pageLocationForNavigation } from '../../lib/appRoutes.ts'
import { desktopFilter } from '../../lib/desktopScreens.ts'

function openDesktopPage(teamId: string, filter: string): void {
  openInApp(
    pageLocationForNavigation(emptyNavigation({ kind: 'team', teamId }, 'team.desktop', { filter }))
      .href,
  )
}

/**
 * Opens a computer's desktop in an app tab, to watch and take over what its agents do:
 * a running Box's own, or with `runtimeId` the screen of the viewer's own computer through
 * that runtime's tunnel, as the iPhone opens it. A Box's tab names only the Box; it asks for
 * its own link each time it connects.
 */
export function openDesktop(deviceId: string, teamId: string, runtimeId?: string): void {
  if (!runtimeId) return openDesktopPage(teamId, deviceId)
  const sessionId = `runtime/${runtimeId}`

  api
    .openSessionDesktop(teamId, sessionId)
    .then(({ display }) => openDesktopPage(teamId, desktopFilter(deviceId, { display, sessionId })))
    .catch((error: unknown) => toast.apiError(t('Could not open the desktop'), error))
}
