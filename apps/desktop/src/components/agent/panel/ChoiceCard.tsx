import { useContext, useState } from 'react'

import { Button } from '../../ui/button'

import { ConnectCardContext } from './connectCardContext'
import { AgentQuote } from './ConnectCardRows'

const TITLE: Record<string, string> = {
  approval: 'Approval needed',
  preference: 'Your choice',
  credential: 'Credential needed',
  integration: 'Integration needed',
  risk_tradeoff: 'Weigh the tradeoff',
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

  return (
    <div className="overflow-hidden rounded-xl border border-zGray-800 bg-zGray-875">
      <div className="px-4 pb-2.5 pt-3.5">
        <div className="text-[13.5px] font-medium text-main">
          {TITLE[category] ?? 'Decision needed'}
        </div>
        <AgentQuote text={question} />
      </div>
      {options.length > 0 ? (
        <div className="flex flex-wrap gap-2 border-t border-zGray-800/60 px-4 py-2.5">
          {options.map((option) => (
            <Button
              key={option}
              variant="secondary"
              size="sm"
              className="h-auto min-h-7 whitespace-normal px-2.5 py-1 text-left text-[12.5px]"
              disabled={!interactive}
              onClick={() => {
                setSent(true)
                ctx?.send(option)
              }}
            >
              {option}
            </Button>
          ))}
        </div>
      ) : (
        canAct && (
          <div className="border-t border-zGray-800/60 px-4 py-2.5 text-[12px] text-tertiary">
            Reply below to answer.
          </div>
        )
      )}
    </div>
  )
}
