export type PlanCommandStatus = 'pending' | 'running' | 'done' | 'failed'

/**
 * `partial` has no equivalent on the wire: only commands carry a status, and a
 * step that holds finished work but nothing in flight is not the same thing as
 * a step being worked on. Treating the two alike made every step the agent had
 * ever touched spin forever, so several appeared to run at once.
 */
export type PlanStepStatus = PlanCommandStatus | 'partial'

export function rollupPlanStatus(
  statuses: readonly PlanCommandStatus[] | undefined,
): PlanStepStatus | null {
  if (!statuses || statuses.length === 0) return null
  if (statuses.some((s) => s === 'failed')) return 'failed'
  if (statuses.every((s) => s === 'done')) return 'done'
  if (statuses.some((s) => s === 'running')) return 'running'
  if (statuses.some((s) => s === 'done')) return 'partial'

  return 'pending'
}

/** Only a literal `running` command means work is in flight right now. */
export function isPlanStatusActive(status: PlanStepStatus | null): boolean {
  return status === 'running'
}

/**
 * Nothing server-side stops a step from being marked `running` while an earlier
 * one still is, so the stored plan can claim several are executing at once.
 * The agent marks a command `running` immediately before it runs it, which
 * makes the LAST such step the real one and any earlier ones markers it forgot
 * to close — those are shown as `partial` rather than rewritten, so the card
 * never invents an outcome the plan does not record.
 */
export function resolveStepStatuses(
  perStep: readonly (readonly PlanCommandStatus[] | undefined)[],
): (PlanStepStatus | null)[] {
  const rolled = perStep.map(rollupPlanStatus)
  const active = rolled.lastIndexOf('running')

  return rolled.map((status, i) => (status === 'running' && i !== active ? 'partial' : status))
}
