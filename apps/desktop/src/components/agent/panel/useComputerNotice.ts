import { diskWarning } from '../../../views/settings/boxMetricsPresentation'
import { useAgentDevices } from '../../../views/settings/useAgentDevices'

import { pausedBoxLabel } from './runtimeControlSignOut'

import type { RuntimeControl } from './RuntimeSelector'

export type ComputerNotice =
  | { kind: 'outdated'; label: string }
  | { kind: 'disk'; label: string; percent: number }
  | { kind: 'paused'; label: string }

/**
 * What the composer says about the selected agent's computer while it still takes the message:
 * a paused Box, which the send resumes; then what will fail a turn on it, a Nuphos too old to
 * be supported, which fails for certain, before a disk that is almost full.
 */
export function useComputerNotice({
  teamId,
  value,
  options,
}: Pick<RuntimeControl, 'teamId' | 'value' | 'options'>): ComputerNotice | null {
  const local = options?.find((instance) => instance.id === value?.id)?.local
  // A paused Box is offline: asking its host to sample metrics would only time out.
  const paused = pausedBoxLabel(local)
  // Neither changes within seconds, so a reading a minute old is current enough for a warning.
  const devices = useAgentDevices(() => 60_000, teamId, {
    metrics: true,
    enabled: Boolean(teamId && local?.deviceId) && paused === null,
    teamId,
  })
  const device = devices.list?.devices.find((candidate) => candidate.deviceId === local?.deviceId)

  // The runtime list already carries the Box's state, so this is said without the device read.
  if (paused !== null) return { kind: 'paused', label: paused }
  if (!device) return null
  if (device.outdated) return { kind: 'outdated', label: device.label }
  const warning = diskWarning(device)

  return warning ? { kind: 'disk', label: device.label, percent: warning.percent } : null
}
