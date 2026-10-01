import type { TranscriptMessage } from './transcript'

export const CONTENT_FILTER_FALLBACK_TEXT =
  "This reply was blocked by the model's safety filter. Try rephrasing your request."

function messageHasVisibleText(parts: unknown[]): boolean {
  return parts.some(
    (part) =>
      part !== null &&
      typeof part === 'object' &&
      (part as { type?: unknown }).type === 'text' &&
      typeof (part as { text?: unknown }).text === 'string' &&
      (part as { text: string }).text.trim().length > 0,
  )
}

// A content-filtered turn (Vertex stop_reason "refusal" → AI SDK
// finishReason "content-filter") can carry no visible text, which would
// persist an empty assistant bubble and post silence to the surface. Append a
// user-facing fallback so the reply is never blank.
export function withContentFilterFallback(
  messages: TranscriptMessage[],
  finishReason: string | null | undefined,
): TranscriptMessage[] {
  if (finishReason !== 'content-filter') return messages
  const lastIndex = messages.length - 1
  const last = messages[lastIndex]

  if (!last || last.role !== 'assistant' || messageHasVisibleText(last.parts)) return messages

  const next = messages.slice()

  next[lastIndex] = {
    ...last,
    parts: [...last.parts, { type: 'text', text: CONTENT_FILTER_FALLBACK_TEXT }],
  }

  return next
}
