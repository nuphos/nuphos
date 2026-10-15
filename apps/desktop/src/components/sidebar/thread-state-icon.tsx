import clsx from 'clsx'
import { Check, CircleAlert, Loader2, Square } from 'lucide-react'

import { threadState } from '../../lib/threadLifecycle'

import type { RuntimeExecution } from '../../lib/runtimeExecution'
import type { ThreadState } from '../../lib/threadLifecycle'
import type { LucideIcon } from 'lucide-react'

/** Same labels, icons and tones as the in-chat thread badges. */
const STATES: Record<ThreadState, { label: string; icon: LucideIcon; tone: string }> = {
  running: { label: 'Running', icon: Loader2, tone: 'text-secondary' },
  waiting: { label: 'Needs input', icon: CircleAlert, tone: 'text-warning' },
  done: { label: 'Done', icon: Check, tone: 'text-success' },
  stopped: { label: 'Stopped', icon: Square, tone: 'text-tertiary' },
}

/** A thread row's icon: whether the thread is running, waiting on someone, done or stopped. */
export function ThreadStateIcon({ snapshot }: { snapshot: RuntimeExecution | undefined }) {
  const state = threadState(snapshot)
  const { label, icon: Icon, tone } = STATES[state]

  return (
    <span title={label} className={clsx('flex-shrink-0 flex items-center', tone)}>
      <Icon
        aria-label={label}
        strokeWidth={2.25}
        className={clsx(
          'h-3.5 w-3.5',
          state === 'running' && 'animate-spin motion-reduce:animate-none',
        )}
      />
    </span>
  )
}
