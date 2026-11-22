import { useSyncExternalStore } from 'react'

import { useAgentDevices } from '../../../views/settings/useAgentDevices'

import { computerNotice } from './computerNotice'
import { diskSnoozeRevision, subscribeDiskSnooze } from './diskSnooze'
import { pausedBoxLabel } from './runtimeControlSignOut'

import type { ComputerNotice as DeviceNotice } from './computerNotice'
import type { RuntimeControl } from './RuntimeSelector'
import type { AgentDevice } from '../../../api'

/** A paused Box, which the send resumes, and what the device list says about the computer. */
export type ComputerNotice = DeviceNotice | { kind: 'paused'; label: string }

/**
 * The selected agent's computer and what the composer says about it while it still takes the
 * message: a paused Box, which the send resumes; then whatever `computerNotice` reads from the device.
 */
export function useComputerNotice({
  teamId,
  value,
  options,
}: Pick<RuntimeControl, 'teamId' | 'value' | 'options'>): {
  notice: ComputerNotice | null
  device: AgentDevice | undefined
  reload: () => void
} {
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

  // Dismissing a disk warning quiets it in every open chat at once, not only the one dismissed.
  useSyncExternalStore(subscribeDiskSnooze, diskSnoozeRevision, diskSnoozeRevision)
  // The runtime list already carries the Box's state, so this is said without the device read.
  const notice: ComputerNotice | null =
    paused !== null ? { kind: 'paused', label: paused } : computerNotice(device)

  return { notice, device, reload: devices.reload }
}
