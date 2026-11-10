import {
  parseChoiceRequest,
  parseConnectRequest,
  parseSecretRequest,
} from '../agent/panel/connectCardModel.ts'
import { questionPart } from '../agent/panel/openQuestionParts.ts'
import { cardReplyId, requestQuestion } from '../agent/panel/replyTarget.ts'

import type { AgentInputRequest } from '../../api/agent-types.ts'
import type { ToolPart } from '../agent/panel/parts.ts'
import type { DecisionCardRef, ReplyQuestion } from '../agent/panel/replyTarget.ts'

/**
 * One open request as a Bot's chat draws it: the card its own conversation
 * draws from the record. The chat answers what the card itself sends, a choice
 * or a secret, and a connection when the chat holds that conversation's
 * credential picker; a free-form reply is made in that conversation.
 */
export function botChatQuestion(
  request: AgentInputRequest,
  canSelectCredentials = false,
): {
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
      (canSelectCredentials && parseConnectRequest(part.input) !== null) ||
      (parseChoiceRequest(part.input)?.options.length ?? 0) > 0,
    replyTo: (card) => (card ? cardReplyId(card, questions) : question.id),
  }
}
