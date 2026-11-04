import { isConversationUnavailable } from '../../api/errors.ts'

// A failed check is tried again on this beat; until it answers, nothing is shown.
const RETRY_MS = 3_000
// After this many failures the agent view opens, which says what is wrong; the
// backend refuses agent turns on a channel.
const MAX_TRIES = 3

/**
 * After a failed kind check: how many tries the session has used, whether the
 * check gives up (the session then opens as an agent), and when to look again.
 * A session the reader can never see (deleted, or private to others) is that
 * answer at once, rather than after every retry.
 */
export function afterFailedCheck(err: unknown, previousTries: number) {
  if (isConversationUnavailable(err)) return { tries: MAX_TRIES, givenUp: true, delayMs: 0 }
  const tries = previousTries + 1

  return { tries, givenUp: tries >= MAX_TRIES, delayMs: RETRY_MS }
}
