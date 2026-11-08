import {
  decisionRequestId,
  parseChoiceRequest,
  parseConnectRequest,
  parseSecretRequest,
} from './connectCardModel.ts'
import { matchInputRequest } from './replyTarget.ts'
import { isDecisionCardPart } from './toolRuns.ts'

import type { Message } from './model.ts'
import type { ToolPart } from './parts.ts'
import type { DecisionCardRef, ReplyQuestion } from './replyTarget.ts'

/** The card a stored call shows, to find the open request it already answers. */
function cardRef(part: ToolPart): DecisionCardRef {
  const connect = parseConnectRequest(part.input)
  const secret = parseSecretRequest(part.input)
  const choice = parseChoiceRequest(part.input)

  return {
    toolCallId: part.toolCallId,
    requestId: decisionRequestId(part.output),
    question: connect?.reason ?? secret?.reason ?? choice?.question,
    options: choice?.options,
    secretName: secret?.name,
  }
}

/** The open request as the card its own conversation shows it with. */
function questionPart(question: ReplyQuestion): ToolPart {
  return {
    type: 'tool',
    toolName: 'request_user_decision',
    toolCallId: question.id,
    // What the record kept of the call: its question, its choices, its secret.
    input: {
      ...(question.secret ? { category: 'credential' } : {}),
      question: question.question,
      ...(question.options ? { options: question.options } : {}),
      ...(question.secretName ? { secretName: question.secretName } : {}),
    },
    state: 'input-available',
  }
}

/**
 * The conversation's open questions that no stored step already shows as a card.
 * A question stays open until it is answered, so its card is drawn from the
 * request record — the same source the Inbox reads — whatever the runtime did or
 * did not keep of the call. A question its transcript already draws is left to
 * it, so a card never appears twice.
 */
export function openQuestionParts(
  messages: readonly Message[],
  open: readonly ReplyQuestion[] | undefined,
): ToolPart[] {
  if (!open || open.length === 0) return []
  const shown = new Set<string>()

  for (const message of messages)
    for (const part of message.parts) {
      if (part.type !== 'tool' || !isDecisionCardPart(part)) continue
      const matched = matchInputRequest(cardRef(part), open)

      if (matched) shown.add(matched.id)
    }

  return open
    .filter((question) => !shown.has(question.id))
    .map(questionPart)
    .filter(isDecisionCardPart)
}
