import { useContext, useMemo } from 'react'

import { runtimeIsExecuting } from '../../../lib/runtimeExecution'

import { DecisionToolPart } from './ConnectCard'
import { ConnectCardContext } from './connectCardContext'
import { openQuestionParts } from './openQuestionParts'

import type { Tab } from './model'

/**
 * The conversation's open questions, drawn under its own transcript from the
 * request record the Inbox reads. A stored step usually draws the card itself;
 * when the runtime kept none, or kept one the transcript cannot read, this is
 * what keeps the question answerable in its own conversation instead of leaving
 * it open in the Inbox alone.
 */
export function OpenQuestionCards({ tab, now }: { tab: Tab; now: number }) {
  const open = useContext(ConnectCardContext)?.openQuestions
  const cards = useMemo(() => openQuestionParts(tab.messages, open), [tab.messages, open])

  if (cards.length === 0) return null
  // Open questions accept replies through the server queue, even while the
  // runtime is busy or offline. Only the viewer's permission gates the card.
  const canReply = !tab.readOnly

  return (
    <>
      {cards.map((part) => (
        <DecisionToolPart
          key={part.toolCallId}
          part={part}
          now={now}
          canAct={!runtimeIsExecuting(tab.runtimeState) && canReply}
          canReply={canReply}
        />
      ))}
    </>
  )
}
