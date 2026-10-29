import type { UIMessage } from 'ai'

const EMPTY_TURN_SENTINEL = /^_?\(no response\)_?$/

/** A runtime transport placeholder is not an answer. Errors are separate parts/frames. */
export function isEmptyTurnText(text: string): boolean {
  return !text.trim() || EMPTY_TURN_SENTINEL.test(text.trim())
}

export function withoutEmptyTurnSentinel(parts: UIMessage['parts']): UIMessage['parts'] {
  return parts.filter((part) => part.type !== 'text' || !isEmptyTurnText(part.text))
}

/** Clean every assistant segment without removing its durable completion boundary. */
export function completedTurnOutput(parts: UIMessage['parts'], segments: UIMessage[]) {
  const cleanParts = withoutEmptyTurnSentinel(parts)
  const steered = segments.map((message) =>
    message.role === 'assistant'
      ? { ...message, parts: withoutEmptyTurnSentinel(message.parts) }
      : message,
  )
  const answer = [
    ...steered
      .filter((message) => message.role === 'assistant')
      .flatMap((message) => message.parts),
    ...cleanParts,
  ]
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('\n\n')

  return { parts: cleanParts, steered, answer }
}
