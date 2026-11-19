import { diskWarning } from '../../../views/settings/boxMetricsPresentation'
import { useAgentDevices } from '../../../views/settings/useAgentDevices'

import type { RuntimeControl } from './RuntimeSelector'

export type ComputerNotice =
  { kind: 'outdated'; label: string } | { kind: 'disk'; label: string; percent: number }

/**
 * What is wrong with the selected agent's computer that will fail a turn on it: a Nuphos too
 * old to be supported, which fails for certain, before a disk that is almost full.
 */
export function useComputerNotice({
  teamId,
  value,
  options,
}: Pick<RuntimeControl, 'teamId' | 'value' | 'options'>): ComputerNotice | null {
  const deviceId = options?.find((instance) => instance.id === value?.id)?.local?.deviceId
  // Neither changes within seconds, so a reading a minute old is current enough for a warning.
  const devices = useAgentDevices(() => 60_000, teamId, {
    metrics: true,
    enabled: Boolean(teamId && deviceId),
    teamId,
  })
  const device = devices.list?.devices.find((candidate) => candidate.deviceId === deviceId)

  if (!device) return null
  if (device.outdated) return { kind: 'outdated', label: device.label }
  const warning = diskWarning(device)

  return warning ? { kind: 'disk', label: device.label, percent: warning.percent } : null
}
