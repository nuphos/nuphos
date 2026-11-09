import { parseChoiceRequest, parseSecretRequest } from '../agent/panel/connectCardModel.ts'
import { questionPart } from '../agent/panel/openQuestionParts.ts'
import { cardReplyId, requestQuestion } from '../agent/panel/replyTarget.ts'

import type { AgentInputRequest } from '../../api/agent-types.ts'
import type { ToolPart } from '../agent/panel/parts.ts'
import type { DecisionCardRef, ReplyQuestion } from '../agent/panel/replyTarget.ts'

/**
 * One open request as a Bot's chat draws it: the card its own conversation
 * draws from the record. The chat answers what the card itself sends, a choice
 * or a secret; a free-form reply or a connection is made in that conversation.
 */
export function botChatQuestion(request: AgentInputRequest): {
  part: ToolPart
  questions: ReplyQuestion[]
  answerable: boolean
  replyTo: (card?: DecisionCardRef) => string
} {
  const question = requestQuestion(request)
  const questions = [question]
  const part = questionPart(question)

  return {
    part,
    questions,
    answerable:
      parseSecretRequest(part.input) !== null ||
      (parseChoiceRequest(part.input)?.options.length ?? 0) > 0,
    replyTo: (card) => (card ? cardReplyId(card, questions) : question.id),
  }
}
