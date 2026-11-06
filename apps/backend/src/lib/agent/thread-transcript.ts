// Per-message budget for stored chat-thread history. Bot messages get more
// room because over-long messages are almost always the agent's.
export const TRANSCRIPT_MESSAGE_CHARS = 500
export const TRANSCRIPT_BOT_MESSAGE_CHARS = 800

/**
 * Clip an over-long transcript message keeping BOTH ends: the head states the
 * topic, the tail carries the agent's question — a head-only cut once turned a
 * question-ending report plus the user's one-word answer into apparent
 * self-talk. Idempotent, so clipping an already clipped text changes nothing.
 */
export function clipTranscriptText(text: string, options?: { fromBot?: boolean }): string {
  const max = options?.fromBot ? TRANSCRIPT_BOT_MESSAGE_CHARS : TRANSCRIPT_MESSAGE_CHARS
  const squashed = text.replace(/\s+/g, ' ').trim()

  if (squashed.length <= max) return squashed
  const head = Math.ceil((max - 3) / 2)
  const tail = max - 3 - head

  return `${squashed.slice(0, head)} … ${squashed.slice(-tail)}`
}
