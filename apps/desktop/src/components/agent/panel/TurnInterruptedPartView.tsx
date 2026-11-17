import { CircleAlert, RotateCcw } from 'lucide-react'
import { useContext } from 'react'

import { t } from '../../../i18n'

import { FailureRow } from './FailureRow'
import { CopyMessageButton } from './messageActions'
import { normalizeAgentError } from './stall'
import { TurnSwitchAgentContext } from './turnFailureActions'
import { TurnRetryContext } from './turnRetryContext'

import type { TurnInterruptedPart } from './parts'

const HEADLINE: Record<TurnInterruptedPart['reason'], string> = {
  cancelled: t('Turn stopped.'),
  timeout: t('Turn timed out.'),
  error: t('Turn failed.'),
}

export function TurnInterruptedPartView({ part }: { part: TurnInterruptedPart }) {
  const detail = normalizeAgentError(part.message)
  // Offered only on the conversation's latest failure line, which the provider names.
  const turnRetry = useContext(TurnRetryContext)
  const retry = turnRetry?.partId === part.id ? turnRetry.retry : undefined
  const copyText = [HEADLINE[part.reason], part.message, part.createdAt].filter(Boolean).join('\n')
  const turnSwitch = useContext(TurnSwitchAgentContext)

  // The agent itself could not run the turn: the row a Bot chat shows, with Switch runtime.
  if (part.cause)
    return (
      <FailureRow
        onSwitchAgent={turnSwitch?.partId === part.id ? turnSwitch.switchAgent : undefined}
        onRetry={retry}
        copyText={copyText}
      >
        <span className="font-medium text-secondary">{HEADLINE[part.reason]}</span>
        {detail && <> {detail}</>}
        {part.repeats && <span className="tabular-nums"> ×{part.repeats}</span>}
      </FailureRow>
    )

  return (
    <div className="group/interrupted flex items-start gap-1.5 text-[12.5px] text-tertiary">
      <CircleAlert className="mt-[2px] h-3.5 w-3.5 shrink-0 text-status-danger" />
      <span className="min-w-0 flex-1">
        <span className="font-medium text-secondary">{HEADLINE[part.reason]}</span>
        {detail && <> {detail}</>}
        {part.repeats && <span className="tabular-nums"> ×{part.repeats}</span>}
      </span>
      {part.reason !== 'cancelled' && (
        <span className="-my-1.5 flex shrink-0 items-center gap-0.5">
          {retry && (
            <button
              type="button"
              onClick={retry}
              className="flex h-7 w-7 items-center justify-center rounded-md text-tertiary transition-colors hover:bg-state-hover hover:text-main outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-line-focus"
              title={t('Retry')}
              aria-label={t('Retry')}
            >
              <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
          )}
          <CopyMessageButton text={copyText} label={t('Copy')} />
        </span>
      )}
    </div>
  )
}
