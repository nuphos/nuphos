// A team's running Boxes may use at most its vCPU limit. Paused, stopped and
// gone machines use none.

import { AppError } from '@/lib/errors'
import { logEvent } from '@/lib/observability'

/** Machine states that use their vCPUs. */
const RUNNING_STATES = new Set(['creating', 'starting', 'running', 'resuming'])

export const isRunning = (state: string) => RUNNING_STATES.has(state)

export function runningVcpus(machines: { state: string; vcpus: number }[]): number {
  return machines.reduce((sum, m) => sum + (isRunning(m.state) ? m.vcpus : 0), 0)
}

/** Refuses starting a Box of `vcpus` when the team's running Boxes would pass `limit`. */
export function assertWithinLimit(
  teamId: string,
  limit: number,
  usedVcpus: number,
  vcpus: number,
): void {
  if (usedVcpus + vcpus <= limit) return
  logEvent('warn', 'agent.box.vcpu_limit_refused', {
    team_id: teamId,
    limit_vcpus: limit,
    used_vcpus: usedVcpus,
    box_vcpus: vcpus,
  })
  if (limit === 0)
    throw new AppError(
      402,
      'box_vcpu_limit',
      "Your team's plan doesn't include cloud computers. Choose a computer plan to start one.",
    )
  throw new AppError(
    402,
    'box_vcpu_limit',
    `This computer needs ${String(vcpus)} vCPU, and your team's running computers already use ${String(usedVcpus)} of the ${String(limit)} in its plan. Pause a computer or choose a bigger plan.`,
  )
}
