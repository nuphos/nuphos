import { ShieldCheck } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../api'
import { t } from '../../i18n'
import { Button } from '../ui/button'

import type { PendingToolApproval } from './toolApprovals'

/**
 * A tool call the Bot's turn waits on, in its owner's chat with it: allowed once
 * or rejected here, as in the Bot's own panel. A reject lets the Bot go on and say
 * it did not run it. The card leaves once the Bot's runtime drops the request.
 */
export function BotChatToolApproval({
  teamId,
  botId,
  approval,
}: {
  teamId: string
  botId: string
  approval: PendingToolApproval
}) {
  const [sent, setSent] = useState(false)
  const [failed, setFailed] = useState(false)

  if (sent) return null
  const decide = (decision: 'allow' | 'reject') => {
    setSent(true)
    setFailed(false)
    api.agentDecideToolApproval(botId, approval.toolCallId, teamId, decision).catch(() => {
      setSent(false)
      setFailed(true)
    })
  }

  return (
    <div
      data-decision-card=""
      className="rounded-lg border border-warning/40 bg-warning/5 px-3 py-2.5"
    >
      <div className="flex items-start gap-1.5 text-[12px] text-main">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-warning" strokeWidth={2} />
        <span className="min-w-0 break-words">
          {approval.title
            ? t('Authorization required — {reason}', { reason: approval.title })
            : t('Authorization required')}
        </span>
      </div>
      {failed && (
        <div className="mt-1.5 text-[12px] text-status-danger">
          {t('Could not send your answer')}
        </div>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Button size="sm" type="button" onClick={() => decide('allow')}>
          {t('Approve once')}
        </Button>
        <button
          type="button"
          onClick={() => decide('reject')}
          className="inline-flex h-8 items-center rounded-md px-3 text-[12px] font-medium text-tertiary transition-colors hover:text-status-danger"
        >
          {t('Deny')}
        </button>
      </div>
    </div>
  )
}
