import type { AgentConversation } from '../../../api/agent-types'

/**
 * An open question a message can answer. A `secret` one (category `credential`)
 * is answered in its secure card, never by typing in the chat.
 */
export type ReplyQuestion = { id: string; question: string; options?: string[]; secret?: true }

/** A question card as the transcript shows it. */
export type DecisionCardRef = { toolCallId: string; question?: string; options?: string[] }

/** A conversation's open questions, oldest first. */
export function conversationQuestions(
  conversation: Pick<AgentConversation, 'pendingDecision'>,
): ReplyQuestion[] {
  const open = conversation.pendingDecision

  return open
    ? [
        {
          id: open.toolCallId,
          question: open.question,
          ...(open.options && { options: open.options }),
          ...(open.category === 'credential' && { secret: true as const }),
        },
      ]
    : []
}

/** The main chat's "Replying to" choice for the open conversation. */
export type ComposerReplyTarget = {
  sessionId: string
  /** Open questions of this conversation, oldest first. */
  questions: ReplyQuestion[]
  /** The question the next message answers; null sends an ordinary message. */
  chosen: string | null
  onChoose: (id: string | null) => void
}

/** The question the user picked, and which questions were open when they did. */
export type ReplyPick = { sessionId: string; id: string; seen: string[] }

/**
 * The question the next main-chat message answers: the one the user picked
 * while it is open, else the newest. Once every open question is one the user
 * cleared, none; a question arriving after a pick or a clear brings the default back.
 */
export function replyChoice(
  sessionId: string,
  questions: readonly ReplyQuestion[],
  pick: ReplyPick | null,
  cleared: readonly string[] = [],
): string | null {
  const newest = questions.at(-1)?.id
  const arrivedSince = (seen: readonly string[]) =>
    questions.some((question) => !seen.includes(question.id))

  if (!newest) return null
  if (
    pick?.sessionId === sessionId &&
    !arrivedSince(pick.seen) &&
    questions.some((question) => question.id === pick.id)
  )
    return pick.id

  return arrivedSince(cleared) ? newest : null
}

const sameOptions = (a?: readonly string[], b?: readonly string[]) =>
  !a || !b || (a.length === b.length && a.every((option, index) => option === b[index]))

/**
 * The open request a question card asked: the one with the card's call id, else (a
 * native runtime's transcript keeps its own id) the oldest asking the same question
 * with the same options. The chat, side panel, Inbox and jump to question all use it.
 */
export function matchInputRequest(
  card: DecisionCardRef,
  questions: readonly ReplyQuestion[],
): ReplyQuestion | undefined {
  return (
    questions.find((open) => open.id === card.toolCallId) ??
    (card.question === undefined
      ? undefined
      : questions.find(
          (open) => open.question === card.question && sameOptions(open.options, card.options),
        ))
  )
}

/** What a card's answer names as decisionReplyTo: its request, else its own call id. */
export function cardReplyId(
  card: DecisionCardRef,
  questions: readonly ReplyQuestion[] | undefined,
): string {
  return (questions && matchInputRequest(card, questions)?.id) ?? card.toolCallId
}
