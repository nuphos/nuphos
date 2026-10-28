/** An open question a message can answer. */
export type ReplyQuestion = { id: string; question: string }

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

/**
 * The open question a choice card answers: its own call id, or, where the
 * transcript keeps the runtime's id for it, the open question asking the same.
 */
export function cardReplyId(
  toolCallId: string,
  question: string | undefined,
  questions: readonly ReplyQuestion[] | undefined,
): string {
  if (!question || !questions || questions.some((open) => open.id === toolCallId)) return toolCallId

  return questions.findLast((open) => open.question === question)?.id ?? toolCallId
}
