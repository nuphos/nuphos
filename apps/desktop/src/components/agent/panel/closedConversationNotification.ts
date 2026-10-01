import {
  buildAgentStopNotification,
  describeStoppedTurn,
} from '../../../lib/agentStopNotification.ts'

import type { StopNotificationMessage } from '../../../lib/agentStopNotification.ts'

// The backend persists the assistant turn in its own onFinish, which races the
// trailing `end` frame the renderer sees. A transcript fetched too early still
// ends on the user's message, so the fetch is retried briefly before giving up
// on a specific body.
export const CLOSED_TRANSCRIPT_RETRY_DELAYS_MS = [0, 1_500, 4_000] as const

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))

/** The notification for a stream whose conversation was closed before it ended.
 *  Reads the persisted transcript so the body says what the agent did, and
 *  falls back to the generic "stopped while closed" sentence when the transcript
 *  cannot be fetched or has not caught up. */
export async function buildClosedConversationNotification(args: {
  title: string
  fetchMessages: () => Promise<readonly StopNotificationMessage[]>
  wait?: (ms: number) => Promise<void>
}): Promise<{ title: string; body: string }> {
  const { title, fetchMessages, wait = sleep } = args
  let messages: readonly StopNotificationMessage[] = []

  for (const delay of CLOSED_TRANSCRIPT_RETRY_DELAYS_MS) {
    if (delay > 0) await wait(delay)
    try {
      messages = await fetchMessages()
    } catch {
      messages = []
    }
    if (describeStoppedTurn(messages)) break
  }

  return buildAgentStopNotification({ outcome: { kind: 'ended-while-closed' }, title, messages })
}
