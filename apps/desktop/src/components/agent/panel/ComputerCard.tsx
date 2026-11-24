import clsx from 'clsx'
import { Check, CircleCheck, Monitor, MousePointer2, ShieldCheck } from 'lucide-react'
import { useContext, useId, useLayoutEffect, useState } from 'react'

import { COMPUTER_OPTIONS } from '../../../api/agent-input-request'
import { t } from '../../../i18n'
import { DesktopScreen } from '../../../views/DesktopFrame'
import { useLiveDesktop } from '../../../views/useLiveDesktop'
import { AgentAvatar } from '../AgentAvatar'

import { DecisionBody } from './ChoiceCard'
import { computerOutcome } from './computerCardModel'
import { CardConversationContext, ConnectCardContext } from './connectCardContext'
import { DecisionAnswersContext } from './decisionAnswers'
import { DecisionTitle } from './DecisionTitle'
import { useDecisionSubmit } from './useDecisionSubmit'

import type { ComputerRequest } from './computerCardModel'
import type { CSSProperties, RefObject } from 'react'

const [DONE, SKIP] = COMPUTER_OPTIONS

const button =
  'inline-flex h-8 items-center gap-1.5 rounded-[9px] px-3 text-[13px] font-medium disabled:opacity-45'
const outlined = clsx(
  button,
  'bg-surface-raised text-main shadow-[0_0_0_1px_rgb(var(--color-line-control)),0_1px_2px_rgba(0,0,0,0.04)] hover:bg-state-hover',
)

/**
 * A `computer` card: the agent hands a person its desktop for a step only they
 * can do. It always shows that desktop live, never a stored picture, in every
 * state. Take over fills the chat pane with it and pauses the agent's input
 * tools there; I'm done hands it back and answers the card, Skip answers it untouched.
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
  const pane = useChatPane(live.host, holding)
  const bot = conversation?.name ?? t('the Bot')
  const answer = (option: string) => {
    if (live.holding) live.hold(false)
    submit({ choices: [option] })
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        data-tool-call-id={toolCallId}
        data-decision-question={question}
        className="flex flex-col gap-2.5 rounded-[14px] border border-line-control bg-surface-raised px-4 pb-3 pt-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
      >
        {ctx?.source && <div>{ctx.source}</div>}
        <div className="flex items-center gap-1.5 text-[12.5px] text-tertiary">
          <Monitor aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">{t('Computer · {name}', { name: desktop.title })}</span>
          {interactive && live.phase.kind === 'connected' && (
            <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-status-success">
              <span className="size-1.5 rounded-full bg-status-success" />
              {t('Live')}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <DecisionTitle className="text-[16px] font-semibold leading-[23px] tracking-[-0.01em] text-main">
            {question}
          </DecisionTitle>
          <DecisionBody text={body} full={ctx?.fullBody} />
        </div>
        <div
          style={holding ? pane : undefined}
          className={clsx(
            'flex flex-col',
            holding
              ? 'fixed z-50 bg-[#0B0B0A]'
              : 'overflow-hidden rounded-[10px] shadow-[0_0_0_1px_rgb(var(--color-line-control))]',
          )}
        >
          {holding && (
            <TakeoverBar sessionId={conversation?.sessionId} bot={bot} computer={desktop.title} />
          )}
          <div className={clsx(holding && 'flex min-h-0 flex-1 items-center justify-center px-4')}>
            <DesktopScreen
              phase={live.phase}
              onRetry={live.retry}
              host={live.host}
              className={
                holding
                  ? 'aspect-video max-h-full w-full rounded-lg shadow-[0_0_0_1px_#FFFFFF14]'
                  : 'aspect-video'
              }
            />
          </div>
          {holding && (
            <TakeoverToolbar bot={bot} computer={desktop.title} onDone={() => answer(DONE)} />
          )}
        </div>
        <ComputerStatus outcome={outcome} failed={failed} by={recorded?.by} />
        {interactive && (
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <button
              type="button"
              className={clsx(button, 'bg-action-primary text-inverse')}
              disabled={live.phase.kind !== 'connected'}
              onClick={() => live.hold(true)}
            >
              <MousePointer2 aria-hidden className="size-3.5" />
              {t('Take over')}
            </button>
            <button type="button" className={outlined} onClick={() => answer(DONE)}>
              {t('I’m done')}
            </button>
            <button type="button" className={outlined} onClick={() => answer(SKIP)}>
              {t('Skip')}
            </button>
          </div>
        )}
      </div>
      {!chosen && (
        <p className="flex gap-1.5 px-1 text-[12px] leading-[17px] text-tertiary">
          <ShieldCheck aria-hidden className="mt-0.5 size-[13px] shrink-0" />
          {t(
            'You sign in on {computer}, {bot}’s computer, and it stays signed in there. The site may email you about a sign-in from a new device.',
            { computer: desktop.title, bot },
          )}
        </p>
      )}
    </div>
  )
}

/**
 * Where the chat pane is while the desktop is held, so the takeover covers the
 * conversation and leaves the sidebar in view; the whole window outside one.
 */
function useChatPane(host: RefObject<HTMLElement | null>, holding: boolean): CSSProperties {
  const [rect, setRect] = useState<CSSProperties>({ inset: 0 })

  useLayoutEffect(() => {
    const pane = holding ? host.current?.closest('[data-chat-pane]') : null

    if (!pane) return
    const measure = () => {
      const { top, left, width, height } = pane.getBoundingClientRect()

      setRect({ top, left, width, height })
    }
    const observer = new ResizeObserver(measure)

    measure()
    observer.observe(pane)

    return () => {
      observer.disconnect()
    }
  }, [host, holding])

  return rect
}

/** The Bot, then the computer, and that the person now holds it. */
function TakeoverBar({
  sessionId,
  bot,
  computer,
}: {
  sessionId: string | undefined
  bot: string
  computer: string
}) {
  return (
    <div className="flex h-[52px] shrink-0 items-center gap-2 px-4 text-[13px]">
      {sessionId && <AgentAvatar agentId={sessionId} size={22} />}
      <span className="truncate font-medium text-[#F5F4F2]">{bot}</span>
      <span className="text-[#8C877F]">·</span>
      <Monitor aria-hidden className="size-3.5 shrink-0 text-[#A8A39B]" />
      <span className="truncate text-[#A8A39B]">{computer}</span>
      <span className="ml-auto flex h-[26px] shrink-0 items-center gap-1.5 rounded-full bg-[#4CB87229] px-2.5 text-[12.5px] font-medium text-[#8BD3A5]">
        <span className="size-1.5 rounded-full bg-[#4CB872]" />
        {t('You’re in control')}
      </span>
    </div>
  )
}

/** I'm done, under the held desktop, and where the person's input goes until then. */
function TakeoverToolbar({
  bot,
  computer,
  onDone,
}: {
  bot: string
  computer: string
  onDone: () => void
}) {
  return (
    <div className="flex h-[118px] shrink-0 flex-col items-center gap-2.5 pt-3">
      <div className="flex items-center gap-1.5 rounded-[14px] bg-[#1F1E1C] p-1.5 shadow-[0_0_0_1px_#FFFFFF14]">
        <button
          type="button"
          onClick={onDone}
          className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-[#FCFBF9] px-4 text-[14px] font-semibold text-[#1C1A17]"
        >
          <Check aria-hidden className="size-4" strokeWidth={2.4} />
          {t('I’m done')}
        </button>
      </div>
      <span className="text-[12px] text-[#8C877F]">
        {t('Your keys and clicks go to {computer}. Choose I’m done to hand it back to {bot}.', {
          computer,
          bot,
        })}
      </span>
    </div>
  )
}

function outcomeText(outcome: NonNullable<ReturnType<typeof computerOutcome>>, by?: string) {
  if (outcome.kind !== 'handed-back')
    return outcome.kind === 'done' ? t('Marked done.') : t('Skipped.')
  const duration = outcome.after

  return by
    ? t('Handed back by {name} after {duration}', { name: by, duration })
    : t('Handed back after {duration}', { duration })
}

/** How the card ended, below the live view. */
function ComputerStatus({
  outcome,
  failed,
  by,
}: {
  outcome: ReturnType<typeof computerOutcome>
  failed: boolean
  by: string | undefined
}) {
  if (outcome)
    return (
      <div className="flex items-center gap-1.5 text-[12.5px] text-secondary">
        <CircleCheck aria-hidden className="size-3.5 shrink-0 text-status-success" />
        {outcomeText(outcome, by)}
      </div>
    )

  return failed ? (
    <div className="text-[12px] text-status-danger">{t('Could not send your answer')}</div>
  ) : null
}
