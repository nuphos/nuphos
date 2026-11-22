import { answerFailure, dismissDecision } from './useInbox.ts'

import type { InboxQuestion } from './inboxItems.ts'

/** What became of a "Dismiss all" once it was sent: the questions refused, back in the list. */
export type DismissAllResult = { failed: InboxQuestion[]; reason?: string }

/**
 * Dismisses every question in `rows` at once, each on its own, as a single
 * Dismiss is: they all leave the list at once. Those refused come back in the
 * list, and `onSent` hears which, with why for one.
 */
export function dismissQuestions(
  teamId: string,
  rows: readonly InboxQuestion[],
  onSent: (result: DismissAllResult) => void,
) {
  void Promise.all(
    rows.map((row) => dismissDecision(teamId, row.conversation.sessionId, row.request.id)),
  ).then((sent) => {
    const failed = rows.filter((_, index) => !sent[index])

    onSent({ failed, reason: failed[0] && answerFailure(failed[0].request.id) })
  })
}
