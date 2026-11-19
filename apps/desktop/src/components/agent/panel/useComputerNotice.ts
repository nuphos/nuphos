import { useAgentDevices } from '../../../views/settings/useAgentDevices'

import { computerNotice } from './computerNotice'

import type { ComputerNotice } from './computerNotice'
import type { RuntimeControl } from './RuntimeSelector'
import type { AgentDevice } from '../../../api'

export type { ComputerNotice } from './computerNotice'

/** The selected agent's computer and its notice, read from the device list (see `computerNotice`). */
export function useComputerNotice({
  teamId,
  value,
  options,
}: Pick<RuntimeControl, 'teamId' | 'value' | 'options'>): {
  notice: ComputerNotice | null
  device: AgentDevice | undefined
  reload: () => void
} {
  const deviceId = options?.find((instance) => instance.id === value?.id)?.local?.deviceId
  // Neither changes within seconds, so a reading a minute old is current enough for a warning.
  const devices = useAgentDevices(() => 60_000, teamId, {
    metrics: true,
    enabled: Boolean(teamId && deviceId),
    teamId,
  })
  const device = devices.list?.devices.find((candidate) => candidate.deviceId === deviceId)

  return { notice: computerNotice(device), device, reload: devices.reload }
}
