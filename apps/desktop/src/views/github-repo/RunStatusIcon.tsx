import { CheckCircle2, Circle, Clock, XCircle } from 'lucide-react'

import { runStatusColor } from './runStatus'

import type { GithubWorkflowRun } from '../../types'

export function RunStatusIcon({ run }: { run: GithubWorkflowRun }) {
  const val = run.conclusion ?? run.status
  const cls = `w-3.5 h-3.5 ${runStatusColor(run)}`

  if (val === 'success') return <CheckCircle2 className={cls} strokeWidth={1.8} />
  if (val === 'failure') return <XCircle className={cls} strokeWidth={1.8} />
  if (val === 'in_progress' || val === 'queued') return <Clock className={cls} strokeWidth={1.8} />

  return <Circle className={cls} strokeWidth={1.8} />
}
