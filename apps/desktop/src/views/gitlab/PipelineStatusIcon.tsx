import { CheckCircle2, Circle, Clock, XCircle } from 'lucide-react'

import { pipelineStatusColor } from './pipelineStatus'

import type { GitlabPipeline } from '../../types'

export function PipelineStatusIcon({ p }: { p: GitlabPipeline }) {
  const cls = `w-3.5 h-3.5 ${pipelineStatusColor(p)}`

  if (p.status === 'success') return <CheckCircle2 className={cls} strokeWidth={1.8} />
  if (p.status === 'failed') return <XCircle className={cls} strokeWidth={1.8} />
  if (p.status === 'running' || p.status === 'pending' || p.status === 'created') {
    return <Clock className={cls} strokeWidth={1.8} />
  }

  return <Circle className={cls} strokeWidth={1.8} />
}
