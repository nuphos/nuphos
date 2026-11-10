import {
  decisionRequestId,
  parseChoiceRequest,
  parseConnectRequest,
  parseSecretRequest,
} from './connectCardModel.ts'
import { matchInputRequest } from './replyTarget.ts'
import { isDecisionCardPart, isDecisionFailed } from './toolRuns.ts'

import type { Message } from './model.ts'
import type { Part, ToolPart } from './parts.ts'
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
export function questionPart(question: ReplyQuestion): ToolPart {
  return {
    type: 'tool',
    toolName: 'request_user_decision',
    toolCallId: question.id,
    // What the record kept of the call: its question, body, choices and secret.
    input: {
      ...(question.secret ? { category: 'credential' } : {}),
      question: question.question,
      ...(question.body ? { body: question.body } : {}),
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
      // A plan's question is its plan card, under the same id.
      if (part.type === 'tool' && part.toolName === 'plan_create') shown.add(part.toolCallId)
      if (part.type !== 'tool' || !isDecisionCardPart(part)) continue
      const matched = matchInputRequest(cardRef(part), open)

      if (matched) shown.add(matched.id)
    }

  return open
    .filter((question) => !shown.has(question.id))
    .map(questionPart)
    .filter(isDecisionCardPart)
}

/**
 * The interrupted row a drawn card makes redundant: a question call the turn
 * ended before answering, whose input the transcript could not read, so it would
 * only say "interrupted" beside the card. A readable call is a card already, and
 * a real failure is no open question — both keep whatever they render today.
 */
function isRedundantQuestionRow(part: Part, open: readonly ReplyQuestion[]): boolean {
  if (part.type !== 'tool' || part.toolName !== 'request_user_decision') return false
  if (part.state !== 'output-error' || isDecisionCardPart(part) || isDecisionFailed(part)) {
    return false
  }

  return matchInputRequest(cardRef(part), open) !== undefined
}

/**
 * The message's parts without the interrupted question rows a drawn card makes
 * redundant, so a question has one UI. A hidden row becomes a step boundary —
 * the transcript's own no-op part — so every index stays as it was for the fold,
 * the recall lead and the tool anchors.
 */
export function withoutQuestionRows(
  parts: Part[],
  open: readonly ReplyQuestion[] | undefined,
): Part[] {
  if (!open || open.length === 0) return parts

  return parts.map((part): Part =>
    isRedundantQuestionRow(part, open) ? { type: 'step-start' } : part,
  )
}
