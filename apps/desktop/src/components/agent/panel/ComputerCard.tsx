import clsx from 'clsx'
import { Monitor } from 'lucide-react'
import { useContext, useId } from 'react'

import { COMPUTER_OPTIONS } from '../../../api/agent-input-request'
import { t } from '../../../i18n'
import { DesktopScreen } from '../../../views/DesktopFrame'
import { useLiveDesktop } from '../../../views/useLiveDesktop'
import { Button } from '../../ui/button'

import { DecisionBody } from './ChoiceCard'
import { computerOutcome } from './computerCardModel'
import { CardConversationContext, ConnectCardContext } from './connectCardContext'
import { DecisionAnswersContext } from './decisionAnswers'
import { DecisionTitle } from './DecisionTitle'
import { useDecisionSubmit } from './useDecisionSubmit'

import type { ComputerRequest } from './computerCardModel'

const [DONE, SKIP] = COMPUTER_OPTIONS

/**
 * A `computer` card: the agent hands a person its desktop for a step only they
 * can do. It always shows that desktop live, never a stored picture, in every
 * state. Take over fills the window with it and pauses the agent's input tools
 * there; I'm done hands it back and answers the card, Skip answers it untouched.
 */
export function ComputerCard({
  toolCallId,
  question,
  body,
  desktop,
  canAct,
}: ComputerRequest & { toolCallId: string; canAct: boolean }) {
  const ctx = useContext(ConnectCardContext)
  const conversation = useContext(CardConversationContext)
  const recorded = useContext(DecisionAnswersContext).get(toolCallId)
  const options = [...COMPUTER_OPTIONS]
  const { chosen, failed, submit } = useDecisionSubmit(
    ctx,
    { toolCallId, question, options },
    recorded?.option,
  )
  // One stream per card on screen: the same card may be drawn in the transcript and among open questions.
  const live = useLiveDesktop(`computer:${toolCallId}:${useId()}`, {
    teamId: conversation?.teamId ?? '',
    sessionId: conversation?.sessionId,
    display: desktop.display,
  })
  const interactive = Boolean(ctx?.answer) && canAct && !chosen
  const outcome = computerOutcome(recorded?.option)
  const holding = live.holding && interactive
  const answer = (option: string) => {
    if (live.holding) live.hold(false)
    submit({ choices: [option] })
  }

  return (
    <div
      data-tool-call-id={toolCallId}
      data-decision-question={question}
      className="flex flex-col rounded-[14px] border border-line-control bg-surface-raised px-4 pb-3 pt-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
    >
      {ctx?.source && <div className="pb-1.5">{ctx.source}</div>}
      <div className="flex items-center gap-1.5 pb-1 text-[12px] text-tertiary">
        <Monitor aria-hidden className="size-3.5" />
        <span className="truncate">{desktop.title}</span>
      </div>
      <DecisionTitle className="text-[16px] font-semibold leading-[23px] tracking-[-0.01em] text-main">
        {question}
      </DecisionTitle>
      <DecisionBody text={body} full={ctx?.fullBody} />
      <div
        className={clsx(
          'flex flex-col bg-surface-raised',
          holding
            ? 'fixed inset-0 z-50'
            : 'mt-3 overflow-hidden rounded-[10px] border border-line-control',
        )}
      >
        {holding && (
          <div className="flex items-center gap-2 border-b border-line-control px-4 py-2 text-[13px]">
            <span className="font-medium text-main">{t('You’re in control')}</span>
            <span className="truncate text-tertiary">{desktop.title}</span>
          </div>
        )}
        <DesktopScreen
          phase={live.phase}
          onRetry={live.retry}
          host={live.host}
          className={holding ? 'min-h-0 flex-1' : 'aspect-video'}
        >
          {outcome?.kind === 'handed-back' && (
            <div className="absolute inset-x-0 bottom-0 bg-black/55 px-3 py-1.5 text-[12px] text-white">
              {recorded?.by
                ? t('Handed back by {name} after {duration}', {
                    name: recorded.by,
                    duration: outcome.after,
                  })
                : t('Handed back after {duration}', { duration: outcome.after })}
            </div>
          )}
        </DesktopScreen>
        {holding && (
          <div className="flex items-center gap-3 border-t border-line-control px-4 py-2.5">
            <Button size="sm" onClick={() => answer(DONE)}>
              {t('I’m done')}
            </Button>
            <span className="text-[12.5px] text-secondary">
              {t('Nuphos’s input tools on this desktop wait until you’re done.')}
            </span>
          </div>
        )}
      </div>
      <ComputerStatus outcome={outcome} failed={failed} />
      {interactive && (
        <div className="flex flex-wrap items-center gap-2 pt-3">
          <Button
            size="sm"
            disabled={live.phase.kind !== 'connected'}
            onClick={() => live.hold(true)}
          >
            {t('Take over')}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => answer(DONE)}>
            {t('I’m done')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => answer(SKIP)}>
            {t('Skip')}
          </Button>
        </div>
      )}
      {!chosen && (
        <p className="pt-2.5 text-[12px] text-tertiary">
          {t('Your sign-in stays on this computer.')}
        </p>
      )}
    </div>
  )
}

/** How the card ended, below the live view; a hand-back says so on the view itself. */
function ComputerStatus({
  outcome,
  failed,
}: {
  outcome: ReturnType<typeof computerOutcome>
  failed: boolean
}) {
  if (outcome?.kind === 'done' || outcome?.kind === 'skipped')
    return (
      <div className="mt-2 text-[12.5px] text-secondary">
        {outcome.kind === 'done' ? t('Marked done.') : t('Skipped.')}
      </div>
    )

  return failed ? (
    <div className="mt-2 text-[12px] text-status-danger">{t('Could not send your answer')}</div>
  ) : null
}
