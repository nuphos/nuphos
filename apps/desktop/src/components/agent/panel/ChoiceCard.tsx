import clsx from 'clsx'
import { ChevronDown, X } from 'lucide-react'
import { useContext, useLayoutEffect, useRef, useState } from 'react'

import { t } from '../../../i18n'
import { comboText } from '../../../lib/platform'
import { SnoozeMenu } from '../../../views/inbox/SnoozeMenu'
import { Button } from '../../ui/button'
import { MessageResponse } from '../MessageResponse'

import { ConnectCardContext } from './connectCardContext'
import { DecisionAnswersContext } from './decisionAnswers'
import { clickOptions, formQuestions, ownBody } from './decisionFormModel'
import { DecisionOptions, PILL } from './DecisionOptions'
import { DecisionTitle } from './DecisionTitle'
import { useDecisionKeys } from './useDecisionKeys'

import type { ConnectCardContextValue } from './connectCardContext'
import type { DecisionQuestion } from './decisionFormModel'
import type { DecisionCardRef } from './replyTarget'
import type { DecisionAnswer } from '../../../api/agent-chat-types'

/**
 * A user decision other than a Connect card: the question as its heading, under
 * who asked it when that is another conversation, with each option an answer,
 * "Other…" to type one in the card instead, then "Snooze" to set it aside until a time
 * and "Dismiss" to withdraw it unanswered, all one row of the same pill
 * (`DecisionOptions`). A multi-select or several questions pick their options and
 * send them at once. The answer
 * wakes the agent that asked; no message is sent. Once answered, the options go.
 */
export function ChoiceCard({
  toolCallId,
  category,
  question,
  body,
  options,
  multiSelect,
  questions,
  canAct,
}: {
  toolCallId: string
  category: string
  question: string
  /** What the agent wrote to decide from: context, findings, links, risks. */
  body?: string
  options: string[]
  multiSelect?: boolean
  /** Related questions answered together; `question` is their headline. */
  questions?: DecisionQuestion[]
  /** The viewer may answer this question. */
  canAct: boolean
}) {
  const ctx = useContext(ConnectCardContext)
  // What the server recorded when it woke the agent with the answer, read from the transcript.
  const recorded = useContext(DecisionAnswersContext).get(toolCallId)?.option
  const card = { toolCallId, question, options }
  const { chosen, failed, submit } = useSubmit(ctx, card, recorded)
  const [dismissed, setDismissed] = useState<'no' | 'sending' | 'yes'>('no')
  const interactive = Boolean(ctx?.answer) && canAct && !chosen && dismissed !== 'yes'
  const typeable = interactive && category !== 'credential'
  const form = formQuestions({ question, options, multiSelect, questions })
  // One question with one answer is answered by a click, so its keys choose.
  const clicked = clickOptions(form)
  const live = interactive && form.some((q) => q.options.length > 0)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const choose = (option: string) => submit({ choices: [option] })
  const act = useDecisionKeys(cardRef, live, (key) => {
    // Picked options are sent with Send, so a key never answers them.
    const option = key.kind === 'option' ? clicked?.[key.index] : undefined

    if (option === undefined) return false

    return choose(option)
  })
  const asides = interactive && (
    <>
      {ctx?.snooze && (
        <SnoozeMenu className={PILL} onSnooze={(until) => ctx.snooze?.(card, until)} />
      )}
      {ctx?.dismiss && (
        <Button
          variant="secondary"
          size="sm"
          className={PILL}
          disabled={dismissed === 'sending'}
          onClick={() => {
            setDismissed('sending')
            void ctx.dismiss?.(card).then((ok) => setDismissed(ok ? 'yes' : 'no'))
          }}
        >
          <X aria-hidden className="size-3.5" />
          {t('Dismiss')}
        </Button>
      )}
    </>
  )

  return (
    <div
      ref={cardRef}
      data-decision-card={live ? '' : undefined}
      data-tool-call-id={toolCallId}
      data-decision-question={question}
      data-decision-options={JSON.stringify(options)}
      className="flex flex-col rounded-[14px] border border-line-control bg-surface-raised px-4 pb-3 pt-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
    >
      {ctx?.source && <div className="pb-1.5">{ctx.source}</div>}
      <DecisionTitle className="text-[16px] font-semibold leading-[23px] tracking-[-0.01em] text-main">
        {question}
      </DecisionTitle>
      <DecisionBody text={ownBody(body, questions)} full={ctx?.fullBody} />
      <AnswerStatus recorded={recorded} failed={failed} dismissed={dismissed === 'yes'} />
      {!chosen && (
        <DecisionOptions
          questions={form}
          disabled={!interactive}
          typeable={typeable}
          hint={
            canAct && (
              <span className="text-[12px] text-tertiary">{t('Reply below to answer.')}</span>
            )
          }
          keyTitle={(index) => (index < 9 ? comboText(`mod+alt+${String(index + 1)}`) : undefined)}
          onSubmit={(answer) => act(() => submit(answer))}
        >
          {asides}
        </DecisionOptions>
      )}
    </div>
  )
}

/**
 * Sends a card's answer: the card goes quiet at once, and is live again with
 * an error if the server refuses it or it could not be sent.
 */
function useSubmit(
  ctx: ConnectCardContextValue | null,
  card: DecisionCardRef,
  recorded: string | undefined,
) {
  const [sent, setSent] = useState(false)
  const [failed, setFailed] = useState(false)
  const submit = (answer: DecisionAnswer) => {
    const taken = ctx?.answer?.(answer, card)

    if (taken === false) return false
    setSent(true)
    setFailed(false)
    void Promise.resolve(taken).then((ok) => {
      if (ok !== false) return
      setSent(false)
      setFailed(true)
    })

    return true
  }

  return { chosen: sent || recorded !== undefined, failed, submit }
}

/** What answered the card, that it was dismissed, or that its answer was not taken. */
function AnswerStatus({
  recorded,
  failed,
  dismissed,
}: {
  recorded: string | undefined
  failed: boolean
  dismissed: boolean
}) {
  if (recorded)
    return (
      <div className="mt-2 text-[12.5px] text-secondary">
        {t('Answered: {answer}', { answer: recorded })}
      </div>
    )

  if (dismissed)
    return (
      <div className="mt-2 text-[12.5px] text-secondary">
        {t('Dismissed. It carries on without an answer.')}
      </div>
    )

  return failed ? (
    <div className="mt-2 text-[12px] text-status-danger">{t('Could not send your answer')}</div>
  ) : null
}

/**
 * The question's markdown body: four lines at first, the last fading out, and a
 * full-width "Show more" under them. The collapsed lines open it too.
 */
function DecisionBody({ text, full = false }: { text: string | undefined; full?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [overflows, setOverflows] = useState(false)
  const [expanded, setExpanded] = useState(full)
  const clipped = overflows && !expanded

  useLayoutEffect(() => {
    const el = ref.current

    if (el && !expanded) setOverflows(el.scrollHeight > el.clientHeight + 1)
  }, [text, expanded])

  if (!text) return null

  return (
    <div className="flex flex-col gap-2 pt-1.5">
      {/* Keyboard users open it with the row below. */}
      <div
        ref={ref}
        onClick={clipped ? () => setExpanded(true) : undefined}
        className={clsx(
          'overflow-hidden',
          !expanded && 'max-h-[88px]',
          clipped &&
            'cursor-pointer [mask-image:linear-gradient(to_bottom,black_calc(100%-28px),transparent)]',
        )}
      >
        <MessageResponse
          className="selectable text-[13.5px] leading-[22px] text-secondary"
          streaming={false}
        >
          {text}
        </MessageResponse>
      </div>
      {!full && (overflows || expanded) && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
          className="flex h-[30px] items-center justify-center gap-1 rounded-lg bg-state-hover text-[12.5px] font-medium text-main"
        >
          {expanded ? t('Show less') : t('Show more')}
          <ChevronDown aria-hidden className={clsx('size-3.5', expanded && 'rotate-180')} />
        </button>
      )}
    </div>
  )
}
