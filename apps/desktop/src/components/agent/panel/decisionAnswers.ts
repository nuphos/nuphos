import { createContext } from 'react'

import { decisionRequestId, parseSecretRequest, secretSavedReply } from './connectCardModel.ts'

import type { Message } from './model'

/** What answered a card: a secure card's saved reply, or the answer the server's notice records. */
export type DecisionAnswer = { option: string }

/**
 * Each conversation's card answers, keyed by the card's tool call id: a secure
 * card's saved reply, and for any other card the answer the server's notice
 * records when it wakes the agent (an answer itself sends no message).
 */
export const DecisionAnswersContext = createContext<ReadonlyMap<string, DecisionAnswer>>(new Map())

/** Which replies answer a secure card: its saved reply. */
function answeredBy(input: unknown): ((text: string) => boolean) | null {
  const secret = parseSecretRequest(input)

  return secret ? (text) => text.startsWith(secretSavedReply(secret.name)) : null
}

/** The sender of the notice an answer wakes the asking agent with. */
const DECISION_NOTICE = 'nuphos:decision'

/** The "- Which regions? → us, eu" lines right after a notice's "Answer:": the answers. */
function noticeAnswer(text: string): string | undefined {
  const lines = text.split('\n')
  const answers: string[] = []

  for (const line of lines.slice(lines.indexOf('Answer:') + 1)) {
    if (!line.startsWith('- ') || !line.includes(' → ')) break
    answers.push(line.slice(line.lastIndexOf(' → ') + 3))
  }

  return lines.includes('Answer:') && answers.length > 0 ? answers.join('; ') : undefined
}

/** The card a server notice records an answer for, and that answer. */
function noticeOf(message: Message, text: string, cards: ReadonlyMap<string, string>) {
  if (message.metadata?.sender.id !== DECISION_NOTICE) return null
  const requestId = /\(requestId ([^)\s]+)\)/.exec(text)?.[1]
  const card = requestId ? cards.get(requestId) : undefined
  const option = noticeAnswer(text)

  return card && option ? { card, option } : null
}

/**
 * A secure card's answer is the first later reply its saved value sent; any
 * other card's is the answer in the server's notice naming its request.
 */
export function decisionAnswers(messages: readonly Message[]): Map<string, DecisionAnswer> {
  const answers = new Map<string, DecisionAnswer>()
  const open: { id: string; matches: (text: string) => boolean }[] = []
  // A card's request id, as its call's result names it, to the card.
  const cards = new Map<string, string>()

  for (const message of messages) {
    if (message.role === 'assistant') {
      for (const part of message.parts) {
        if (part.type !== 'tool' || part.toolName !== 'request_user_decision') continue
        const matches = answeredBy(part.input)

        cards.set(decisionRequestId(part.output) ?? part.toolCallId, part.toolCallId)
        if (matches) open.push({ id: part.toolCallId, matches })
      }
      continue
    }
    const text = message.parts
      .map((part) => (part.type === 'text' ? part.text : ''))
      .join('')
      .trim()
    const noticed = noticeOf(message, text, cards)

    if (noticed) answers.set(noticed.card, { option: noticed.option })
    const index = open.findLastIndex((entry) => entry.matches(text))

    if (index < 0) continue
    // Answered once: a later reply goes to another card.
    const [card] = open.splice(index, 1)

    answers.set(card.id, { option: text })
  }

  return answers
}
