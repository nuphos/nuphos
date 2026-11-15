import { useMemo } from 'react'

import {
  AskedCardsContext,
  DecisionAnswersContext,
  askedCards,
  decisionAnswers,
} from './decisionAnswers'

import type { Message } from './model'
import type { ReactNode } from 'react'

/** A transcript's question cards and their answers, for the cards and notices drawn in it. */
export function DecisionCardsProvider({
  messages,
  children,
}: {
  messages: readonly Message[]
  children: ReactNode
}) {
  const answers = useMemo(() => decisionAnswers(messages), [messages])
  const asked = useMemo(() => askedCards(messages), [messages])

  return (
    <DecisionAnswersContext.Provider value={answers}>
      <AskedCardsContext.Provider value={asked}>{children}</AskedCardsContext.Provider>
    </DecisionAnswersContext.Provider>
  )
}
