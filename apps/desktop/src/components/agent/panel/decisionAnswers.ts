import { createContext } from 'react'

import { decisionRequestId, parseSecretRequest, secretSavedReply } from './connectCardModel.ts'
import { DECISION_NOTICE, parseDecisionNotice } from './decisionNotice.ts'

import type { Message } from './model'

/** What answered a card: a secure card's saved reply, or the answer the server's notice records, and who gave it. */
export type DecisionAnswer = { option: string; by?: string }

/**
 * Each conversation's card answers, keyed by the card's tool call id: a secure
 * card's saved reply, and for any other card the answer the server's notice
 * records when it wakes the agent (an answer itself sends no message).
 */
/** The line each answered card shows while its answer waits for the agent, by request id. */
export const WaitingAnswersContext = createContext<ReadonlyMap<string, string>>(new Map())

export const DecisionAnswersContext = createContext<ReadonlyMap<string, DecisionAnswer>>(new Map())

/** Which replies answer a secure card: its saved reply. */
function answeredBy(input: unknown): ((text: string) => boolean) | null {
  const secret = parseSecretRequest(input)

  return secret ? (text) => text.startsWith(secretSavedReply(secret.name)) : null
}

/** A question card in the transcript: what was asked, and when. */
export type AskedCard = { toolCallId: string; input: unknown; askedAt?: number }

/** Each question card of a conversation, by its request id as the card's result names it. */
export const AskedCardsContext = createContext<ReadonlyMap<string, AskedCard>>(new Map())

export function askedCards(messages: readonly Message[]): Map<string, AskedCard> {
  const cards = new Map<string, AskedCard>()

  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const part of message.parts) {
      if (part.type !== 'tool' || part.toolName !== 'request_user_decision') continue
      cards.set(decisionRequestId(part.output) ?? part.toolCallId, {
        toolCallId: part.toolCallId,
        input: part.input,
        askedAt: message.createdAt,
      })
    }
  }

  return cards
}

/** The card a server notice records an answer for, and that answer. */
function noticeOf(message: Message, text: string, cards: ReadonlyMap<string, AskedCard>) {
  const notice = message.metadata?.sender.id === DECISION_NOTICE ? parseDecisionNotice(text) : null
  const card = notice && cards.get(notice.requestId)

  return notice && card
    ? {
        card: card.toolCallId,
        option: notice.answers.map(({ answer }) => answer).join('; '),
        by: notice.answeredBy,
      }
    : null
}

/**
 * A secure card's answer is the first later reply its saved value sent; any
 * other card's is the answer in the server's notice naming its request.
 */
export function decisionAnswers(messages: readonly Message[]): Map<string, DecisionAnswer> {
  const answers = new Map<string, DecisionAnswer>()
  const open: { id: string; matches: (text: string) => boolean }[] = []
  const cards = askedCards(messages)

  for (const message of messages) {
    if (message.role === 'assistant') {
      for (const part of message.parts) {
        if (part.type !== 'tool' || part.toolName !== 'request_user_decision') continue
        const matches = answeredBy(part.input)

        if (matches) open.push({ id: part.toolCallId, matches })
      }
      continue
    }
    const text = message.parts
      .map((part) => (part.type === 'text' ? part.text : ''))
      .join('')
      .trim()
    const noticed = noticeOf(message, text, cards)

    if (noticed) answers.set(noticed.card, { option: noticed.option, by: noticed.by })
    const index = open.findLastIndex((entry) => entry.matches(text))

    if (index < 0) continue
    // Answered once: a later reply goes to another card.
    const [card] = open.splice(index, 1)

    answers.set(card.id, { option: text })
  }

  return answers
}
