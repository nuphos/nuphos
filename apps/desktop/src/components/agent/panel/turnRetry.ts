import { sentHistory } from './composerRecall.ts'

import type { Message } from './model.ts'
import type { TurnInterruptedPart } from './parts.ts'

/**
 * The viewer's own prompt behind the conversation's latest turn when that turn
 * failed or timed out, or undefined. A turn the person stopped is not offered.
 */
export function failedTurnPrompt(
  messages: Pick<Message, 'role' | 'parts' | 'metadata' | 'turnKind'>[],
  currentUserId: string | undefined,
  foreignChat: boolean,
): string | undefined {
  const reply = messages.at(-1)

  if (reply?.role !== 'assistant') return undefined
  const interrupted = reply.parts.findLast(
    (part): part is TurnInterruptedPart => part.type === 'turn-interrupted',
  )

  if (!interrupted || interrupted.reason === 'cancelled') return undefined
  const prompt = messages.at(-2)

  return prompt ? sentHistory([prompt], currentUserId, foreignChat)[0] : undefined
}
