import { diskWarning } from '../../../views/settings/boxMetricsPresentation'
import { useAgentDevices } from '../../../views/settings/useAgentDevices'

import type { RuntimeControl } from './RuntimeSelector'

/** The selected agent's computer, when its disk is almost full: its name and how full. */
export function useComputerDiskWarning({
  teamId,
  value,
  options,
}: Pick<RuntimeControl, 'teamId' | 'value' | 'options'>) {
  const deviceId = options?.find((instance) => instance.id === value?.id)?.local?.deviceId
  // A disk fills over hours, so a reading a minute old is current enough for a warning.
  const devices = useAgentDevices(() => 60_000, teamId, {
    metrics: true,
    enabled: Boolean(teamId && deviceId),
    teamId,
  })
  const device = devices.list?.devices.find((candidate) => candidate.deviceId === deviceId)
  const warning = diskWarning(device)

  return device && warning ? { label: device.label, percent: warning.percent } : null
}
