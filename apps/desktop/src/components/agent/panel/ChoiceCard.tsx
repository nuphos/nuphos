import clsx from 'clsx'
import { Check } from 'lucide-react'
import { useContext, useRef, useState } from 'react'

import { useCurrentUser } from '../../../hooks/useCurrentUser'
import { t } from '../../../i18n'
import { comboText } from '../../../lib/platform'
import { Button } from '../../ui/button'

import { ConnectCardContext } from './connectCardContext'
import { AgentQuote } from './ConnectCardRows'
import { DecisionAnswersContext } from './decisionAnswers'
import { formatMessageTimestamp } from './streamText'
import { useDecisionKeys } from './useDecisionKeys'

const TITLE: Record<string, string> = {
  approval: t('Approval needed'),
  preference: t('Your choice'),
  credential: t('Credential needed'),
  integration: t('Integration needed'),
  risk_tradeoff: t('Weigh the tradeoff'),
}

/**
 * A user decision other than a Connect card: the question, with each option sent
 * as the reply. Once answered, the chosen option stays marked, with who chose it.
 */
export function ChoiceCard({
  toolCallId,
  category,
  question,
  options,
  canAct,
}: {
  toolCallId: string
  category: string
  question: string
  options: string[]
  /** The latest reply and no turn running: only then can an option be sent. */
  canAct: boolean
}) {
  const ctx = useContext(ConnectCardContext)
  const answer = useContext(DecisionAnswersContext).get(toolCallId)
  const viewer = useCurrentUser()
  const [sent, setSent] = useState<string | null>(null)
  const chosen = answer?.option ?? sent
  const interactive = Boolean(ctx) && canAct && !chosen
  const live = interactive && options.length > 0
  const cardRef = useRef<HTMLDivElement | null>(null)
  const choose = (option: string) => {
    setSent(option)
    ctx?.send(option, { toolCallId, question, options })
  }
  const act = useDecisionKeys(cardRef, live, (key) => {
    const option = key.kind === 'option' ? options[key.index] : undefined

    if (option === undefined) return false
    choose(option)

    return true
  })

  return (
    <div
      ref={cardRef}
      data-decision-card={live ? '' : undefined}
      data-tool-call-id={toolCallId}
      data-decision-question={question}
      data-decision-options={JSON.stringify(options)}
      className="overflow-hidden rounded-xl border border-zGray-800 bg-zGray-875"
    >
      <div className="px-4 pb-2.5 pt-3.5">
        <div className="text-[13.5px] font-medium text-main">
          {TITLE[category] ?? t('Decision needed')}
        </div>
        <AgentQuote text={question} />
      </div>
      {options.length > 0 ? (
        <div className="flex flex-wrap gap-2 border-t border-zGray-800/60 px-4 py-2.5">
          {options.map((option, index) => (
            <Button
              key={option}
              variant="secondary"
              size="sm"
              className={clsx(
                'h-auto min-h-7 gap-1.5 whitespace-normal px-2.5 py-1 text-left text-[12.5px]',
                // Important: the disabled fade's order among variants is not fixed.
                option === chosen && '!opacity-100 border-zViolet-accent/60 bg-zViolet-accent/10',
              )}
              disabled={!interactive}
              aria-pressed={chosen ? option === chosen : undefined}
              title={index < 9 ? comboText(`mod+alt+${String(index + 1)}`) : undefined}
              onClick={() => act(() => choose(option))}
            >
              {option === chosen && (
                <Check className="h-3.5 w-3.5 shrink-0 text-zViolet-accent" strokeWidth={2.25} />
              )}
              {option}
            </Button>
          ))}
          {answer?.at !== undefined && (
            <div className="basis-full text-[11.5px] text-tertiary">
              {answer.sender && answer.sender.id !== viewer?.id
                ? t('Answered by {name} · {time}', {
                    name: answer.sender.displayName,
                    time: formatMessageTimestamp(answer.at),
                  })
                : t('You answered · {time}', { time: formatMessageTimestamp(answer.at) })}
            </div>
          )}
        </div>
      ) : (
        canAct && (
          <div className="border-t border-zGray-800/60 px-4 py-2.5 text-[12px] text-tertiary">
            {t('Reply below to answer.')}
          </div>
        )
      )}
    </div>
  )
}
