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
 * credential picker. A question answered in words is typed in the chat's
 * composer, quoting it, and sent as its answer.
 */
export function botChatQuestion(
  request: AgentInputRequest,
  canSelectCredentials = false,
): {
  part: ToolPart
  questions: ReplyQuestion[]
  answerable: boolean
  /** Whether it can be answered in words: never a plan, which is approved or rejected, nor a credential. */
  typed: boolean
  replyTo: (card?: DecisionCardRef) => string
} {
  const question = requestQuestion(request)
  const questions = [question]
  const part = questionPart(question)
  const choice = parseChoiceRequest(part.input)
  const typed = choice !== null && request.category !== 'credential' && !request.planId

  return {
    part,
    questions,
    answerable:
      parseSecretRequest(part.input) !== null ||
      (canSelectCredentials && parseConnectRequest(part.input) !== null) ||
      (choice?.options.length ?? 0) > 0 ||
      typed,
    typed,
    replyTo: (card) => (card ? cardReplyId(card, questions) : question.id),
  }
}
