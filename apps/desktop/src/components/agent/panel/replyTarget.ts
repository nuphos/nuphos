import type { AgentConversation } from '../../../api/agent-types'

/** An open question a message can answer. */
export type ReplyQuestion = { id: string; question: string; options?: string[] }

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

/** What the user picked, and which questions were open when they did. */
export type ReplyPick = { sessionId: string; id: string | null; seen: string[] }

/**
 * The question the next main-chat message answers: the newest open one,
 * unless the user picked another or cleared the chip. A question arriving
 * after that choice brings the default back.
 */
export function replyChoice(
  sessionId: string,
  questions: readonly ReplyQuestion[],
  pick: ReplyPick | null,
): string | null {
  const newest = questions.at(-1)?.id

  if (!newest) return null
  if (
    !pick ||
    pick.sessionId !== sessionId ||
    questions.some((question) => !pick.seen.includes(question.id))
  )
    return newest
  if (pick.id === null) return null

  return questions.some((question) => question.id === pick.id) ? pick.id : newest
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
