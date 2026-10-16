// A team's running Boxes may use at most its vCPU limit. Paused, stopped and
// gone machines use none.

import { AppError } from '@/lib/errors'

/** Machine states that use their vCPUs. */
const RUNNING_STATES = new Set(['creating', 'starting', 'running', 'resuming'])

export const isRunning = (state: string) => RUNNING_STATES.has(state)

export function runningVcpus(machines: { state: string; vcpus: number }[]): number {
  return machines.reduce((sum, m) => sum + (isRunning(m.state) ? m.vcpus : 0), 0)
}

/** Refuses starting a Box of `vcpus` when the team's running Boxes would pass `limit`. */
export function assertWithinLimit(limit: number, usedVcpus: number, vcpus: number): void {
  if (usedVcpus + vcpus <= limit) return
  if (limit === 0)
    throw new AppError(402, 'box_vcpu_limit', 'Your team has no Box plan; upgrade to start a Box')
  throw new AppError(
    402,
    'box_vcpu_limit',
    `This Box needs ${String(vcpus)} vCPU, and your team's running Boxes already use ${String(usedVcpus)} of its ${String(limit)}. Pause a Box or upgrade.`,
  )
}
