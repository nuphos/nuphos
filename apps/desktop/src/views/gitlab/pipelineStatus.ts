import type { GitlabPipeline } from '../../types'

export function pipelineStatusColor(p: GitlabPipeline): string {
  if (p.status === 'success' || p.status === 'manual') return 'text-status-success'
  if (p.status === 'failed') return 'text-error'
  if (p.status === 'running' || p.status === 'pending' || p.status === 'created') {
    return 'text-status-warning'
  }

  return 'text-tertiary'
}
