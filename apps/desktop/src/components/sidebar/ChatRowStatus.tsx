import { CircleAlert, Loader2 } from 'lucide-react'

import { t } from '../../i18n'
import { chatRowIndicator, runtimeStateLabel } from '../../lib/runtimeExecution'
import { StatusDot } from '../ui/status-dot'

import type { RuntimeExecution } from '../../lib/runtimeExecution'

/**
 * The run's state, at the row's right edge. The icon only ever names the agent;
 * the unread and waiting dots sit in the row's left gutter (SidebarNavItem `dot`).
 */
export function ChatRowStatus({
  runtimeState: state,
}: {
  runtimeState: RuntimeExecution | undefined
}) {
  const indicator = chatRowIndicator(state, false)

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

  return <StatusDot tone="warning" label={t('Background task running')} />
}
