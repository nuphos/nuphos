import { useState } from 'react'

import type { ConnectCardContextValue } from './connectCardContext'
import type { DecisionCardRef } from './replyTarget'
import type { DecisionAnswer } from '../../../api/agent-chat-types'

/**
 * Sends a card's answer: the card goes quiet at once, and is live again with
 * an error if the server refuses it or it could not be sent.
 */
export function useDecisionSubmit(
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
