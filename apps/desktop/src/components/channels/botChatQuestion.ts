import {
  answeredBySelection,
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
  /** Whether it can be answered in words: never a plan, a credential's value, or a connection the server answers by selection. */
  typed: boolean
  replyTo: (card?: DecisionCardRef) => string
} {
  const question = requestQuestion(request)
  const questions = [question]
  const part = questionPart(question)
  const choice = parseChoiceRequest(part.input)
  // As the server's decision_not_answerable: only selecting what it names answers it.
  const bySelection = answeredBySelection(request)
  // A credential takes words only beside its options, never as its value (#4029).
  const typed =
    choice !== null &&
    !bySelection &&
    !request.planId &&
    (request.category !== 'credential' || choice.options.length > 0)

  return {
    part,
    questions,
    answerable:
      parseSecretRequest(part.input) !== null ||
      (canSelectCredentials && parseConnectRequest(part.input) !== null) ||
      (!bySelection && (choice?.options.length ?? 0) > 0) ||
      typed,
    typed,
    replyTo: (card) => (card ? cardReplyId(card, questions) : question.id),
  }
}
