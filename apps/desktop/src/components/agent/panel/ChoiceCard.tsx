import clsx from 'clsx'
import { useContext, useLayoutEffect, useRef, useState } from 'react'

import { t } from '../../../i18n'
import { comboText } from '../../../lib/platform'
import { Button } from '../../ui/button'
import { MessageResponse } from '../MessageResponse'

import { ConnectCardContext } from './connectCardContext'
import { AgentQuote } from './ConnectCardRows'
import { DecisionAnswersContext } from './decisionAnswers'
import { formQuestions } from './decisionForm'
import { DecisionForm } from './DecisionForm'
import { useDecisionKeys } from './useDecisionKeys'

import type { ConnectCardContextValue } from './connectCardContext'
import type { DecisionQuestion } from './decisionForm'

const TITLE: Record<string, string> = {
  approval: t('Approval needed'),
  preference: t('Your choice'),
  credential: t('Credential needed'),
  integration: t('Integration needed'),
  risk_tradeoff: t('Weigh the tradeoff'),
}

/**
 * A user decision other than a Connect card: the question, with each option sent
 * as the reply, like quick-reply chips, and "Other…" to type an answer in the
 * composer instead. A multi-select or several questions are a form sent as one
 * reply. Once answered, the options go: the answer is the reply bubble that follows.
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
  const answer = useContext(DecisionAnswersContext).get(toolCallId)
  const [sent, setSent] = useState<string | null>(null)
  const chosen = answer?.option ?? sent
  const interactive = Boolean(ctx) && canAct && !chosen
  const form = formQuestions({ question, options, multiSelect, questions })
  const live = interactive && (form !== null || options.length > 0)
  const reply = typedReply(ctx, interactive, category)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const choose = (option: string) => {
    if (!ctx || ctx.send(option, { toolCallId, question, options }) === false) return false
    setSent(option)

    return true
  }
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
        <DecisionBody text={body} full={ctx?.fullBody} />
      </div>
      {!chosen &&
        (form ? (
          <DecisionForm
            questions={form}
            disabled={!interactive}
            onSubmit={(text) => act(() => choose(text))}
          />
        ) : (
          <ChoiceActions
            options={options}
            interactive={interactive}
            canAct={canAct}
            onChoose={(option) => act(() => choose(option))}
            onReply={reply && (() => reply({ toolCallId, question, options }))}
          />
        ))}
    </div>
  )
}

/** One option per reply button, and "Other…" to answer in the composer instead. */
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

/** "Other…": a typed answer in the composer while the card is live; never a credential's value, which must not become a message. */
function typedReply(ctx: ConnectCardContextValue | null, interactive: boolean, category: string) {
  return interactive && category !== 'credential' ? ctx?.reply : undefined
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
