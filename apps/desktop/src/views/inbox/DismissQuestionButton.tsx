import clsx from 'clsx'
import { useState } from 'react'

import { api } from '../../api'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'
import { refreshInputRequests } from '../../lib/inputRequestRefresh'

/**
 * Withdraws an open question unanswered: no message is sent and the agent is
 * not woken. Every list of open questions, the Inbox and a Bot's chat alike,
 * drops it on the refresh this starts.
 */
export function DismissQuestionButton({
  teamId,
  sessionId,
  requestId,
  className,
}: {
  teamId: string
  sessionId: string
  requestId: string
  className?: string
}) {
  const [dismissing, setDismissing] = useState(false)

  async function dismiss() {
    setDismissing(true)
    try {
      await api.agentResolveDecision(sessionId, requestId, teamId, 'dismissed')
      refreshInputRequests()
    } catch (error) {
      toast.apiError(t('Could not dismiss question'), error)
    } finally {
      setDismissing(false)
    }
  }

  return (
    <button
      type="button"
      disabled={dismissing}
      onClick={() => void dismiss()}
      className={clsx('text-[11px] text-tertiary hover:text-main', className)}
    >
      {dismissing ? t('Dismissing...') : t('Dismiss question')}
    </button>
  )
}
