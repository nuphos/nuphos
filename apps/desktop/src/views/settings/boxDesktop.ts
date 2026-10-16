import { api } from '../../api'
import { emptyNavigation, pageLocationForNavigation } from '../../lib/appRoutes'

/** Opens a running Box's desktop in an app tab, to watch and take over what its agents do. */
export async function openBoxDesktop(deviceId: string, teamId: string): Promise<void> {
  const { url } = await api.boxDesktop(deviceId, teamId)
  const href = pageLocationForNavigation(
    emptyNavigation({ kind: 'team', teamId }, 'team.desktop', { browserUrl: url }),
  ).href

  window.dispatchEvent(new CustomEvent('nuphos:open-in-app', { detail: href }))
}
