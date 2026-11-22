import { useMemo } from 'react'

import { requestQuestion } from '../panel/replyTarget'

import type { ReplyQuestion } from '../panel/replyTarget'
import type { SessionInputRequest } from './sessionInputRequests'

/**
 * The open conversation's own questions, so a card answers its own one whatever
 * id the transcript keeps. Undefined until listed, so a card doesn't read "not
 * listed yet" as answered.
 */
export function useOpenQuestions(
  sessionId: string | null,
  { requests, loaded }: { requests: readonly SessionInputRequest[]; loaded: boolean },
): ReplyQuestion[] | undefined {
  return useMemo(
    () =>
      loaded
        ? requests.flatMap(({ sessionId: asker, inputRequest }) =>
            asker === sessionId ? [requestQuestion(inputRequest)] : [],
          )
        : undefined,
    [loaded, requests, sessionId],
  )
}
