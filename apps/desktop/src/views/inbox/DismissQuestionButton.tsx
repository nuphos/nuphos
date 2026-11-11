import clsx from 'clsx'
import { useState } from 'react'

import { api } from '../../api'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'
import { refreshInputRequests } from '../../lib/inputRequestRefresh'

/**
 * Closes an open question without answering it: one none of the choices fits
 * and the work has moved past. Every list of open questions drops it on the
 * next refresh, which this starts.
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
