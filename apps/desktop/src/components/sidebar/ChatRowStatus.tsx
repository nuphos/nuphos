import { CircleAlert, Loader2 } from 'lucide-react'

import { t } from '../../i18n'
import { runtimeStateLabel } from '../../lib/runtimeExecution'
import { rowIndicator } from '../../lib/subAgentState'
import { StatusDot } from '../ui/status-dot'

import type { RuntimeExecution } from '../../lib/runtimeExecution'
import type { RowDot } from '../../lib/subAgentState'
import type { StatusDotTone } from '../ui/status-dot'

const DOTS: Record<'background' | 'unread' | 'waiting', { label: string; tone: StatusDotTone }> = {
  background: { label: t('Background task running'), tone: 'warning' },
  unread: { label: t('Unread reply'), tone: 'unread' },
  waiting: { label: t('Needs your input'), tone: 'attention' },
}

/** The row's status, at its right edge. The icon only ever names the agent. */
export function ChatRowStatus({
  runtimeState: state,
  dot,
}: {
  runtimeState: RuntimeExecution | undefined
  dot: RowDot
}) {
  const indicator = rowIndicator(state, dot)

  if (indicator === 'none') return null
  if (indicator === 'turn' || indicator === 'error') {
    const Icon = indicator === 'turn' ? Loader2 : CircleAlert

    return (
      <span
        title={runtimeStateLabel(state)}
        className="flex-shrink-0 flex items-center text-tertiary"
      >
        <Icon
          className={`h-3.5 w-3.5 ${indicator === 'turn' ? 'animate-spin' : ''}`}
          aria-label={runtimeStateLabel(state)}
        />
      </span>
    )
  }
  const { label, tone } = DOTS[indicator]

  return <StatusDot tone={tone} label={label} />
}
