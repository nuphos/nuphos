import { Check, CircleAlert, Loader2, Square } from 'lucide-react'

import type { ThreadStatus } from './threadStatus'
import type { LucideIcon } from 'lucide-react'

/** How a thread's status reads, shared by the in-chat badges and the sidebar rows. */
export const THREAD_STATUS: Record<
  ThreadStatus,
  { label: string; icon?: LucideIcon; tone: string }
> = {
  loading: { label: '', tone: 'text-tertiary' },
  running: { label: 'Running', icon: Loader2, tone: 'text-secondary' },
  waiting: { label: 'Needs input', icon: CircleAlert, tone: 'text-warning' },
  done: { label: 'Done', icon: Check, tone: 'text-success' },
  stopped: { label: 'Stopped', icon: Square, tone: 'text-tertiary' },
  unavailable: { label: 'Unavailable', tone: 'text-tertiary' },
}
