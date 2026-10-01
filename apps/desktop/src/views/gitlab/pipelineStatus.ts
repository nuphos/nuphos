import type { GitlabPipeline } from '../../types'

export function pipelineStatusColor(p: GitlabPipeline): string {
  if (p.status === 'success' || p.status === 'manual') return 'text-[#73bf69]'
  if (p.status === 'failed') return 'text-error'
  if (p.status === 'running' || p.status === 'pending' || p.status === 'created') {
    return 'text-amber-400'
  }

  return 'text-tertiary'
}
