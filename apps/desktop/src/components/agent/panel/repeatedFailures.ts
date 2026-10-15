import type { Message } from './model'
import type { TurnInterruptedPart } from './parts'

/** The failure line of a reply that is nothing but a failed turn, or undefined. */
function failureOnly(message: Message): TurnInterruptedPart | undefined {
  if (message.role !== 'assistant') return undefined
  const visible = message.parts.filter((part) => part.type !== 'step-start')
  const [part] = visible

  return visible.length === 1 && part.type === 'turn-interrupted' && part.reason === 'error'
    ? part
    : undefined
}

/**
 * A runtime that refuses every turn (out of usage, signed out) answers each
 * queued message with the same failure. Of a run of identical failure-only
 * replies only the latest stays, counting the turns it stands for; the
 * messages they answered all stay.
 */
export function collapseRepeatedFailures(messages: Message[]): Message[] {
  const out: Message[] = []
  let last: { index: number; part: TurnInterruptedPart } | undefined

  for (const message of messages) {
    const failure = failureOnly(message)

    if (!failure) {
      if (message.role === 'assistant') last = undefined
      out.push(message)
      continue
    }
    if (last?.part.message !== failure.message) {
      last = { index: out.length, part: failure }
      out.push(message)
      continue
    }
    const part = { ...failure, repeats: (last.part.repeats ?? 1) + 1 }

    out.splice(last.index, 1)
    last = { index: out.length, part }
    out.push({ ...message, parts: message.parts.map((p) => (p === failure ? part : p)) })
  }

  return out
}
