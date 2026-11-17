import { getConversationMessages } from '@/lib/agent/db'
import { withCurrentAgentNames } from '@/lib/agent/sender-names'

import { transcriptTailFrame } from './errors'

// Messages read back before a turn's own, to find the input it answered.
const TAIL_FRAME_WINDOW = 200

/**
 * The `atlas-transcript-tail` frame for a turn that just stored `added` messages,
 * `count` in all. Reads the recent window, not a long session's whole transcript.
 * The stored timestamps go too: download cards use them to stay with their turn.
 */
export async function storedTranscriptTail(
  sessionId: string,
  userId: string,
  teamId: string | undefined,
  count: number,
  added: number,
): Promise<Record<string, unknown>> {
  const stored = await withCurrentAgentNames(
    await getConversationMessages(sessionId, userId, { tail: added + TAIL_FRAME_WINDOW }),
    teamId,
  )

  return transcriptTailFrame(stored, count - added, count - stored.length)
}
