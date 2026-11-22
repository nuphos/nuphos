import { canManage } from '../../../views/settings/agentPresentation.ts'
import { diskWarning } from '../../../views/settings/boxMetricsPresentation.ts'

import { diskSnoozed } from './diskSnooze.ts'

import type { AgentDevice } from '../../../api/device-types.ts'

export type ComputerNotice =
  | { kind: 'outdated'; label: string }
  | { kind: 'disk'; label: string; percent: number; deviceId: string }

/**
 * What is wrong with the selected agent's computer that will fail a turn on it: a Nuphos too
 * old to be supported, which fails for certain, before a disk that is almost full. The disk
 * is said only to those who can free space on it; everyone else sees it in the runtime picker.
 * A disk warning they have put away stays away until it means something new (`diskSnooze`);
 * the computer's own card in settings goes on saying it, so nothing is lost, only quieted.
 */
export function computerNotice(
  device:
    | Pick<AgentDevice, 'deviceId' | 'label' | 'outdated' | 'access' | 'metricsStatus' | 'metrics'>
    | undefined,
): ComputerNotice | null {
  if (!device) return null
  if (device.outdated) return { kind: 'outdated', label: device.label }
  if (!canManage(device)) return null
  const warning = diskWarning(device)

  if (!warning || diskSnoozed(device.deviceId, warning.percent)) return null

  return { kind: 'disk', label: device.label, percent: warning.percent, deviceId: device.deviceId }
}
