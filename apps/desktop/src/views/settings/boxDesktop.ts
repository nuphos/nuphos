import { emptyNavigation, pageLocationForNavigation } from '../../lib/appRoutes'

/**
 * Opens a running Box's desktop in an app tab, to watch and take over what its
 * agents do. The tab names only the Box; it asks for its own link each time it connects.
 */
export function openBoxDesktop(deviceId: string, teamId: string): void {
  const href = pageLocationForNavigation(
    emptyNavigation({ kind: 'team', teamId }, 'team.desktop', { filter: deviceId }),
  ).href

  window.dispatchEvent(new CustomEvent('nuphos:open-in-app', { detail: href }))
}
