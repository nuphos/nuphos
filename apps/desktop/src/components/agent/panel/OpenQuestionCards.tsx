import { useContext, useMemo } from 'react'

import { runtimeAllows, runtimeIsExecuting } from '../../../lib/runtimeExecution'

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
  // The gate the transcript's own cards use: the runtime takes a reply and this
  // viewer may send one. A question open in the record is answerable even while
  // a turn runs, so the newest idle reply is not required.
  const canReply =
    (runtimeAllows(tab.runtimeState, 'send') || runtimeAllows(tab.runtimeState, 'reply')) &&
    !tab.readOnly

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
