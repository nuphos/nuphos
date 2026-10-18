import clsx from 'clsx'
import { Loader2 } from 'lucide-react'

import { threadStatusOf } from '../agent/panel/threadStatus'
import { THREAD_STATUS } from '../agent/panel/threadStatusStyle'

import type { RuntimeExecution } from '../../lib/runtimeExecution'

/** A thread row's icon, read and drawn the way its badge in the chat is. */
export function ThreadStateIcon({ snapshot }: { snapshot: RuntimeExecution | undefined }) {
  const { label, icon: Icon, tone } = THREAD_STATUS[threadStatusOf(snapshot)]

  if (!Icon) return null

  return (
    <span title={label} className={clsx('flex-shrink-0 flex items-center', tone)}>
      <Icon
        aria-label={label}
        strokeWidth={2.25}
        className={clsx(
          'h-3.5 w-3.5',
          Icon === Loader2 && 'animate-spin motion-reduce:animate-none',
        )}
      />
    </span>
  )
}
