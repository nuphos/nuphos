import { useMemo } from 'react'

import {
  AskedCardsContext,
  DecisionAnswersContext,
  WaitingAnswersContext,
  askedCards,
  decisionAnswers,
} from './decisionAnswers'

import type { Message, Tab } from './model'
import type { ReactNode } from 'react'

/** A transcript's question cards and their answers, for the cards and notices drawn in it. */
export function DecisionCardsProvider({
  messages,
  waiting,
  children,
}: {
  messages: readonly Message[]
  waiting?: Tab['waitingAnswers']
  children: ReactNode
}) {
  const answers = useMemo(() => decisionAnswers(messages), [messages])
  const asked = useMemo(() => askedCards(messages), [messages])
  const notes = useMemo(
    () => new Map((waiting ?? []).map((entry) => [entry.requestId, entry.note])),
    [waiting],
  )

  return (
    <DecisionAnswersContext.Provider value={answers}>
      <AskedCardsContext.Provider value={asked}>
        <WaitingAnswersContext.Provider value={notes}>{children}</WaitingAnswersContext.Provider>
      </AskedCardsContext.Provider>
    </DecisionAnswersContext.Provider>
  )
}
