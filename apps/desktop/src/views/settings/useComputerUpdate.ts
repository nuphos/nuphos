import { api } from '../../api'

import {
  appUpdateConfirm,
  appUpdateLabel,
  boxUpdateConfirm,
  boxUpdateLabel,
} from './boxRestartPresentation'
import { restartsIntoUpdate } from './computerOutdated'
import { useBoxHostUpdate } from './useBoxHostUpdate'

import type { AgentDevice } from '../../api'

/**
 * The update a computer's ⋯ menu offers: a Box's host CLI, or the Nuphos Desktop on another of
 * the viewer's own computers, which restarts into the update it downloaded.
 */
export function useComputerUpdate(
  teamId: string,
  device: AgentDevice | undefined,
  host: { cloud: boolean; thisComputer: boolean; running: boolean; hostAgent?: string },
) {
  const boxUpdate = useBoxHostUpdate(teamId, host.hostAgent)
  const app =
    !host.cloud &&
    !host.thisComputer &&
    host.running &&
    device?.app &&
    restartsIntoUpdate(device.app)
      ? device.app
      : undefined
  const appUpdate = app?.update?.ready ? app.update.version : undefined
  const boxLabel = boxUpdate === undefined ? undefined : boxUpdateLabel(boxUpdate)

  return {
    /** The menu item, offered only when `version` is set; none when there is nothing to say. */
    label: host.cloud ? boxLabel : app && appUpdateLabel(app),
    version: host.cloud ? boxUpdate : appUpdate,
    confirm: (version: string, label: string) =>
      host.cloud ? boxUpdateConfirm(label, version || undefined) : appUpdateConfirm(label, version),
    request: async (deviceId: string, team: string) => {
      if (!host.cloud) await api.deviceAppUpdate(deviceId, team)
      else if (host.hostAgent) await api.atlasRequestRuntimeUpdate(team, host.hostAgent)
    },
  }
}
