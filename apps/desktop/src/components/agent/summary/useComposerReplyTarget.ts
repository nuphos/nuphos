import { useCallback, useMemo, useState } from 'react'

import { replyChoice } from '../panel/replyTarget'

import type { AgentConversation } from '../../../api/agent-types'
import type { ComposerReplyTarget, ReplyPick, ReplyQuestion } from '../panel/replyTarget'

/** The open conversation's questions as the main chat's "Replying to" choice. */
export function useComposerReplyTarget(
  sessionId: string | null,
  requests: readonly AgentConversation[],
): ComposerReplyTarget | undefined {
  const questions = useMemo<ReplyQuestion[]>(
    () =>
      requests.flatMap((request) =>
        request.sessionId === sessionId && request.pendingDecision
          ? [{ id: request.pendingDecision.toolCallId, question: request.pendingDecision.question }]
          : [],
      ),
    [requests, sessionId],
  )
  const [pick, setPick] = useState<ReplyPick | null>(null)
  const onChoose = useCallback(
    (id: string | null) => {
      if (sessionId) setPick({ sessionId, id, seen: questions.map((question) => question.id) })
    },
    [questions, sessionId],
  )

  if (!sessionId || questions.length === 0) return undefined

  return { sessionId, questions, chosen: replyChoice(sessionId, questions, pick), onChoose }
}
