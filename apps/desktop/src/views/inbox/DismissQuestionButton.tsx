import clsx from 'clsx'
import { useState } from 'react'

import { t } from '../../i18n'

import { dismissQuestion } from './dismissQuestion'

/** Withdraws the open question of a card that has no "Dismiss" of its own. */
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

  return (
    <button
      type="button"
      disabled={dismissing}
      onClick={() => {
        setDismissing(true)
        void dismissQuestion(teamId, sessionId, requestId).finally(() => setDismissing(false))
      }}
      className={clsx('text-[11px] text-tertiary hover:text-main', className)}
    >
      {dismissing ? t('Dismissing...') : t('Dismiss question')}
    </button>
  )
}
