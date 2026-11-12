import clsx from 'clsx'
import { useContext, useLayoutEffect, useRef, useState } from 'react'

import { t } from '../../../i18n'
import { comboText } from '../../../lib/platform'
import { Button } from '../../ui/button'
import { MessageResponse } from '../MessageResponse'

import { ConnectCardContext } from './connectCardContext'
import { AgentQuote } from './ConnectCardRows'
import { DecisionAnswersContext } from './decisionAnswers'
import { DecisionForm } from './DecisionForm'
import { formQuestions, ownBody } from './decisionFormModel'
import { useDecisionKeys } from './useDecisionKeys'

import type { ConnectCardContextValue } from './connectCardContext'
import type { DecisionQuestion } from './decisionFormModel'
import type { DecisionCardRef } from './replyTarget'
import type { DecisionAnswer } from '../../../api/agent-chat-types'

const TITLE: Record<string, string> = {
  approval: t('Approval needed'),
  preference: t('Your choice'),
  credential: t('Credential needed'),
  integration: t('Integration needed'),
  risk_tradeoff: t('Weigh the tradeoff'),
}

/**
 * A user decision other than a Connect card: the question, with each option an
 * answer, like quick-reply chips, and "Other…" to type one in the card instead.
 * A multi-select or several questions are a form sent as one answer. The answer
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
  const { chosen, failed, submit } = useSubmit(ctx, { toolCallId, question, options }, recorded)
  const [typing, setTyping] = useState(false)
  const interactive = Boolean(ctx?.answer) && canAct && !chosen
  // "Other…" is the same form with the question alone and no options.
  const form = typing
    ? [{ question, options: [], multiSelect: false }]
    : formQuestions({ question, options, multiSelect, questions })
  const live = interactive && (form !== null || options.length > 0)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const choose = (option: string) => submit({ choices: [option] })
  const act = useDecisionKeys(cardRef, live, (key) => {
    // A form's options are toggles, not answers.
    const option = key.kind === 'option' && !form ? options[key.index] : undefined

    if (option === undefined) return false

    return choose(option)
  })

  return (
    <div
      ref={cardRef}
      data-decision-card={live ? '' : undefined}
      data-tool-call-id={toolCallId}
      data-decision-question={question}
      data-decision-options={JSON.stringify(options)}
      className="overflow-hidden rounded-xl surface-raised bg-surface-raised"
    >
      <div className="px-4 pb-2.5 pt-3.5">
        <div className="text-[13.5px] font-medium text-main">
          {TITLE[category] ?? t('Decision needed')}
        </div>
        <AgentQuote text={question} />
        <DecisionBody text={ownBody(body, questions)} full={ctx?.fullBody} />
        <AnswerStatus recorded={recorded} failed={failed} />
      </div>
      {!chosen &&
        (form ? (
          <DecisionForm
            questions={form}
            disabled={!interactive}
            onSubmit={(answer) => act(() => submit(answer))}
          />
        ) : (
          <ChoiceActions
            options={options}
            interactive={interactive}
            canAct={canAct}
            onChoose={(option) => act(() => choose(option))}
            onReply={interactive && category !== 'credential' ? () => setTyping(true) : undefined}
          />
        ))}
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

/** What answered the card, or that its answer was not taken. */
function AnswerStatus({ recorded, failed }: { recorded: string | undefined; failed: boolean }) {
  if (recorded)
    return (
      <div className="mt-2 text-[12.5px] text-secondary">
        {t('Answered: {answer}', { answer: recorded })}
      </div>
    )

  return failed ? (
    <div className="mt-2 text-[12px] text-status-danger">{t('Could not send your answer')}</div>
  ) : null
}

/** One option per answer button, and "Other…" to type the answer in the card instead. */
function ChoiceActions({
  options,
  interactive,
  canAct,
  onChoose,
  onReply,
}: {
  options: string[]
  interactive: boolean
  canAct: boolean
  onChoose: (option: string) => void
  onReply: (() => void) | undefined
}) {
  if (options.length === 0 && !onReply)
    return canAct ? (
      <div className="border-t border-line-control/60 px-4 py-2.5 text-[12px] text-tertiary">
        {t('Reply below to answer.')}
      </div>
    ) : null

  return (
    <div className="flex flex-wrap gap-2 border-t border-line-control/60 px-4 py-2.5">
      {options.map((option, index) => (
        <Button
          key={option}
          variant="secondary"
          size="sm"
          className="h-auto min-h-7 whitespace-normal px-2.5 py-1 text-left text-[12.5px]"
          disabled={!interactive}
          title={index < 9 ? comboText(`mod+alt+${String(index + 1)}`) : undefined}
          onClick={() => onChoose(option)}
        >
          {option}
        </Button>
      ))}
      {onReply && (
        <Button
          variant="ghost"
          size="sm"
          className="h-auto min-h-7 px-2.5 py-1 text-[12.5px] text-secondary"
          onClick={onReply}
        >
          {options.length > 0 ? t('Other…') : t('Reply…')}
        </Button>
      )}
    </div>
  )
}

/** The question's markdown body, a few lines at first; "Show more" reveals the rest. */
function DecisionBody({ text, full = false }: { text: string | undefined; full?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [overflows, setOverflows] = useState(false)
  const [expanded, setExpanded] = useState(full)

  useLayoutEffect(() => {
    const el = ref.current

    if (el && !expanded) setOverflows(el.scrollHeight > el.clientHeight + 1)
  }, [text, expanded])

  if (!text) return null

  return (
    <div className="mt-2">
      <div ref={ref} className={clsx('overflow-hidden', !expanded && 'max-h-[4.5em]')}>
        <MessageResponse className="selectable text-[12.5px] text-secondary" streaming={false}>
          {text}
        </MessageResponse>
      </div>
      {!full && (overflows || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          className="mt-1 text-[12px] text-tertiary hover:text-main"
        >
          {expanded ? t('Show less') : t('Show more')}
        </button>
      )}
    </div>
  )
}
