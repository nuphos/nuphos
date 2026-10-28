import { useCallback, useEffect, useMemo, useState } from 'react'

import { composerDraftKey } from '../panel/composerDrafts'
import { loadClearedReplies, saveClearedReplies } from '../panel/composerReplyCleared'
import { conversationQuestions, replyChoice } from '../panel/replyTarget'

import type { AgentConversation } from '../../../api/agent-types'
import type { ComposerReplyTarget, ReplyPick, ReplyQuestion } from '../panel/replyTarget'

/**
 * The open conversation's questions as the main chat's "Replying to" choice.
 * A cleared chip is remembered per conversation until a newer question arrives.
 */
export function useComposerReplyTarget(
  sessionId: string | null,
  teamId: string | undefined,
  requests: readonly AgentConversation[],
  loaded: boolean,
): ComposerReplyTarget | undefined {
  const questions = useMemo<ReplyQuestion[]>(
    () =>
      requests.flatMap((request) =>
        request.sessionId === sessionId ? conversationQuestions(request) : [],
      ),
    [requests, sessionId],
  )
  const key = sessionId ? composerDraftKey(teamId, sessionId) : null
  const [pick, setPick] = useState<ReplyPick | null>(null)
  const [stored, setStored] = useState(() => ({ key, ids: key ? loadClearedReplies(key) : [] }))

  if (stored.key !== key) setStored({ key, ids: key ? loadClearedReplies(key) : [] })
  const storedIds = stored.key === key ? stored.ids : null
  // Answered or dismissed questions leave the record, once the listing says what is open.
  const cleared = useMemo(() => {
    if (!storedIds || !loaded) return storedIds ?? []
    const open = new Set(questions.map((question) => question.id))

    return storedIds.filter((id) => open.has(id))
  }, [loaded, questions, storedIds])

  useEffect(() => {
    if (key && storedIds && cleared.length !== storedIds.length) saveClearedReplies(key, cleared)
  }, [cleared, key, storedIds])

  const onChoose = useCallback(
    (id: string | null) => {
      if (!sessionId || !key) return
      const seen = questions.map((question) => question.id)

      if (id === null) {
        saveClearedReplies(key, seen)
        setStored({ key, ids: seen })
        setPick(null)
      } else {
        setPick({ sessionId, id, seen })
      }
    },
    [key, questions, sessionId],
  )

  if (!sessionId || questions.length === 0) return undefined

  return {
    sessionId,
    questions,
    chosen: replyChoice(sessionId, questions, pick, cleared),
    onChoose,
  }
}
