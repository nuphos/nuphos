import type { V1Job } from '@kubernetes/client-node'

export function jobPhase(job: V1Job): string {
  const conditions = (job.status?.conditions ?? []).filter((c) => c.status === 'True')

  if (conditions.some((c) => c.type === 'Failed' || c.type === 'FailureTarget')) return 'Failed'
  if (conditions.some((c) => c.type === 'Complete')) return 'Complete'
  if (conditions.some((c) => c.type === 'SuccessCriteriaMet')) return 'Completing'
  if (job.spec?.suspend || job.spec?.parallelism === 0) return 'Suspended'
  const desired = job.spec?.completions ?? 1

  if (desired > 0 && (job.status?.succeeded ?? 0) >= desired) return 'Complete'
  // Failed attempts are retry history, not a terminal Job condition.
  if ((job.status?.failed ?? 0) > 0) return 'Retrying'
  if ((job.status?.active ?? 0) > 0) return 'Running'

  return 'Pending'
}
