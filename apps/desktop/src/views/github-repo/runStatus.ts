import type { GithubWorkflowRun } from '../../types'

export function runStatusColor(run: GithubWorkflowRun): string {
  const val = run.conclusion ?? run.status

  if (val === 'success') return 'text-status-success'
  if (val === 'failure') return 'text-error'
  if (val === 'in_progress' || val === 'queued') return 'text-status-warning'

  return 'text-tertiary'
}
