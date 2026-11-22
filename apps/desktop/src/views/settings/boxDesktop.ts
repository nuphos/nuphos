import { openInApp } from '../../app/workspace/openInApp.ts'
import { emptyNavigation, pageLocationForNavigation } from '../../lib/appRoutes.ts'
import { desktopFilter } from '../../lib/desktopScreens.ts'

function openDesktopPage(teamId: string, filter: string): void {
  openInApp(
    pageLocationForNavigation(emptyNavigation({ kind: 'team', teamId }, 'team.desktop', { filter }))
      .href,
  )
}

/**
 * Opens a Box's own desktop in an app tab, to watch and take over what its agents do.
 * The tab names only the Box; its host opens the desktop each time the tab connects.
 */
export function openBoxDesktop(deviceId: string, teamId: string): void {
  openDesktopPage(teamId, deviceId)
}

/** Opens the screen of the viewer's own computer, whose runtime `runtime/<id>` gave it `display`. */
export function openComputerScreen(
  deviceId: string,
  teamId: string,
  sessionId: string,
  display: number,
) {
  openDesktopPage(teamId, desktopFilter(deviceId, { display, sessionId }))
}
