import clsx from 'clsx'
import { ChevronDown, X } from 'lucide-react'
import { useContext, useEffect, useRef, useState } from 'react'

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
import { useDecisionSubmit as useSubmit } from './useDecisionSubmit'

import type { DecisionQuestion } from './decisionFormModel'
import type { ReactNode } from 'react'

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
  selectOnly,
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
  /** Still open, and only selecting what it names answers it: no option or words, which the server refuses. */
  selectOnly?: boolean
}) {
  const ctx = useContext(ConnectCardContext)
  // What the server recorded when it woke the agent with the answer, read from the transcript.
  const recorded = useContext(DecisionAnswersContext).get(toolCallId)?.option
  const card = { toolCallId, question, options }
  const { chosen, failed, submit } = useSubmit(ctx, card, recorded)
  const [dismissed, setDismissed] = useState<'no' | 'sending' | 'yes'>('no')
  const interactive = Boolean(ctx?.answer) && canAct && !chosen && dismissed !== 'yes'
  const answers = interactive && !selectOnly
  // A credential takes words only beside its options, never as its value (#4029).
  const typeable = answers && (category !== 'credential' || options.length > 0)
  const form = formQuestions({ question, options, multiSelect, questions })
  // One question with one answer is answered by a click, so its keys choose.
  const clicked = clickOptions(form)
  const live = answers && form.some((q) => q.options.length > 0)
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
      {!chosen &&
        (selectOnly ? (
          <SelectToAnswer>{asides}</SelectToAnswer>
        ) : (
          <DecisionOptions
            questions={form}
            disabled={!interactive}
            typeable={typeable}
            hint={
              canAct && (
                <span className="text-[12px] text-tertiary">{t('Reply below to answer.')}</span>
              )
            }
            keyTitle={(index) =>
              index < 9 ? comboText(`mod+alt+${String(index + 1)}`) : undefined
            }
            onSubmit={(answer) => act(() => submit(answer))}
          >
            {asides}
          </DecisionOptions>
        ))}
    </div>
  )
}

/** In place of the options of a question only a selection answers: where to make it, then Snooze and Dismiss. */
function SelectToAnswer({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 pt-3">
      <span className="text-[12px] text-tertiary">
        {t('Select what it asks for in the credential picker to answer.')}
      </span>
      {children}
    </div>
  )
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
 * The question's markdown body: four whole lines at first, the last ending in an
 * ellipsis, and a full-width "Show more" under them when that cuts it.
 */
export function DecisionBody({ text, full = false }: { text: string | undefined; full?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [cut, setCut] = useState(false)
  const [expanded, setExpanded] = useState(full)

  // Measured whenever its size changes, so a card laid out while hidden still finds out.
  useEffect(() => {
    const el = ref.current

    if (!el || expanded) return
    const observer = new ResizeObserver(() => setCut(el.scrollHeight > el.clientHeight + 1))

    observer.observe(el)

    return () => observer.disconnect()
  }, [text, expanded])

  if (!text) return null

  return (
    <div className="flex flex-col gap-2 pt-1.5">
      <div ref={ref} className={clsx(!expanded && 'line-clamp-4')}>
        <MessageResponse
          className="selectable text-[13.5px] leading-[22px] text-secondary"
          streaming={false}
        >
          {text}
        </MessageResponse>
      </div>
      {!full && (cut || expanded) && (
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
