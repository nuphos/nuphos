import { useContext, useRef, useState } from 'react'

import { t } from '../../../i18n'
import { comboText } from '../../../lib/platform'
import { Button } from '../../ui/button'

import { ConnectCardContext } from './connectCardContext'
import { AgentQuote } from './ConnectCardRows'
import { useDecisionKeys } from './useDecisionKeys'

const TITLE: Record<string, string> = {
  approval: t('Approval needed'),
  preference: t('Your choice'),
  credential: t('Credential needed'),
  integration: t('Integration needed'),
  risk_tradeoff: t('Weigh the tradeoff'),
}

/** A user decision other than a Connect card: the question, with each option sent as the reply. */
export function ChoiceCard({
  category,
  question,
  options,
  canAct,
}: {
  category: string
  question: string
  options: string[]
  /** The latest reply and no turn running: only then can an option be sent. */
  canAct: boolean
}) {
  const ctx = useContext(ConnectCardContext)
  const [sent, setSent] = useState(false)
  const interactive = Boolean(ctx) && canAct && !sent
  const live = interactive && options.length > 0
  const cardRef = useRef<HTMLDivElement | null>(null)
  const choose = (option: string) => {
    setSent(true)
    ctx?.send(option)
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
              className="h-auto min-h-7 whitespace-normal px-2.5 py-1 text-left text-[12.5px]"
              disabled={!interactive}
              title={index < 9 ? comboText(`mod+alt+${String(index + 1)}`) : undefined}
              onClick={() => act(() => choose(option))}
            >
              {option}
            </Button>
          ))}
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
