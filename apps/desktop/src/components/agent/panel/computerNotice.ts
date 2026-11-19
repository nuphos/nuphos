import { canManage } from '../../../views/settings/agentPresentation.ts'
import { diskWarning } from '../../../views/settings/boxMetricsPresentation.ts'

import type { AgentDevice } from '../../../api/device-types.ts'

export type ComputerNotice =
  { kind: 'outdated'; label: string } | { kind: 'disk'; label: string; percent: number }

/**
 * What is wrong with the selected agent's computer that will fail a turn on it: a Nuphos too
 * old to be supported, which fails for certain, before a disk that is almost full. The disk
 * is said only to those who can free space on it; everyone else sees it in the runtime picker.
 */
export function computerNotice(
  device:
    Pick<AgentDevice, 'label' | 'outdated' | 'access' | 'metricsStatus' | 'metrics'> | undefined,
): ComputerNotice | null {
  if (!device) return null
  if (device.outdated) return { kind: 'outdated', label: device.label }
  if (!canManage(device)) return null
  const warning = diskWarning(device)

  return warning ? { kind: 'disk', label: device.label, percent: warning.percent } : null
}
