import { sentHistory } from './composerRecall.ts'

import type { Message } from './model.ts'
import type { TurnInterruptedPart } from './parts.ts'
import type { AgentMessageMention } from '../../../api/agent-types.ts'

/** The latest turn's failure line and the prompt Retry would resend. */
export type FailedTurn = {
  partId: string
  prompt: string
  /** The teammates the prompt @mentioned, so a resend notifies the same people. */
  mentions?: AgentMessageMention[]
}

/**
 * The viewer's own prompt behind the conversation's latest turn when that turn
 * failed or timed out, or undefined. A turn the person stopped is not offered,
 * nor a prompt with attachments: resending only its text would ask something else.
 */
export function failedTurn(
  messages: Pick<Message, 'role' | 'parts' | 'metadata' | 'turnKind'>[],
  currentUserId: string | undefined,
  foreignChat: boolean,
): FailedTurn | undefined {
  const reply = messages.at(-1)

  if (reply?.role !== 'assistant') return undefined
  const interrupted = reply.parts.findLast(
    (part): part is TurnInterruptedPart => part.type === 'turn-interrupted',
  )

  if (!interrupted || interrupted.reason === 'cancelled') return undefined
  const asked = messages.at(-2)

  if (!asked || asked.parts.some((part) => part.type !== 'text')) return undefined
  const prompt = sentHistory([asked], currentUserId, foreignChat)[0]

  if (!prompt) return undefined
  const mentions = asked.metadata?.mentions

  return { partId: interrupted.id, prompt, ...(mentions?.length ? { mentions } : {}) }
}
