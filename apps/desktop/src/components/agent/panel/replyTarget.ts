import { openInputRequests } from '../../../lib/agentInputRequests.ts'

import type { AgentConversation, AgentInputRequest } from '../../../api/agent-types'

/**
 * An open question a message can answer. A `secret` one (category `credential`)
 * is answered in its secure card, never by typing in the chat.
 */
export type ReplyQuestion = {
  id: string
  question: string
  /** The markdown the agent wrote to decide from. */
  body?: string
  options?: string[]
  secret?: true
  secretName?: string
}

/** A question card as the transcript shows it. */
export type DecisionCardRef = {
  toolCallId: string
  /** The request id the tool result names, when it differs from the call id. */
  requestId?: string
  question?: string
  options?: string[]
  /** A secure input card's secret. */
  secretName?: string
}

/** One open request as a question; a `credential` one is a secret. */
export function requestQuestion({
  id,
  question,
  body,
  options,
  category,
  secretName,
}: Pick<
  AgentInputRequest,
  'id' | 'question' | 'body' | 'options' | 'category' | 'secretName'
>): ReplyQuestion {
  return {
    id,
    question,
    ...(body && { body }),
    ...(options && { options }),
    ...(category === 'credential' && { secret: true as const }),
    ...(secretName && { secretName }),
  }
}

/** A conversation's open questions, oldest first. */
export function conversationQuestions(
  conversation: Pick<AgentConversation, 'inputRequests' | 'pendingDecision'>,
): ReplyQuestion[] {
  return openInputRequests(conversation).map(requestQuestion)
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
 * with the same options. A secret also needs the same secret name where the request
 * keeps one, and two open requests it could be is a tie that matches neither, so a
 * value never goes to the wrong one. The chat, side panel, Inbox and jump to question all use it.
 */
export function matchInputRequest(
  card: DecisionCardRef,
  questions: readonly ReplyQuestion[],
): ReplyQuestion | undefined {
  const byId = questions.find((open) => open.id === card.toolCallId || open.id === card.requestId)

  if (byId || card.question === undefined) return byId
  const same = questions.filter(
    (open) => open.question === card.question && sameOptions(open.options, card.options),
  )

  if (card.secretName === undefined) return same[0]
  const named = same.filter((open) => !open.secretName || open.secretName === card.secretName)

  return named.length === 1 ? named[0] : undefined
}

/** What a card's answer names as decisionReplyTo: its request, else its own call id. */
export function cardReplyId(
  card: DecisionCardRef,
  questions: readonly ReplyQuestion[] | undefined,
): string {
  return (questions && matchInputRequest(card, questions)?.id) ?? card.toolCallId
}

/**
 * Whether a decision card takes an answer, and if not, why. A question still open
 * in the record stays answerable after later messages and while a turn runs. Without
 * the record, or once it is closed, only the latest idle reply can act.
 */
export type CardAnswerState = 'open' | 'closed' | 'busy' | 'offline'

export function cardAnswerState(
  card: DecisionCardRef,
  openQuestions: readonly ReplyQuestion[] | undefined,
  { latestIdle, canReply }: { latestIdle: boolean; canReply: boolean },
): CardAnswerState {
  if (!canReply) return 'offline'
  if (latestIdle || (openQuestions && matchInputRequest(card, openQuestions))) return 'open'

  return openQuestions ? 'closed' : 'busy'
}
