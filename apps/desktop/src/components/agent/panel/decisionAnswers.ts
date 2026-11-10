import { createContext } from 'react'

import { parseChoiceRequest, parseConnectRequest, parseSecretRequest } from './connectCardModel.ts'

import type { Message } from './model'

/** The option a choice card was answered with, from the reply stored in the transcript. */
export type DecisionAnswer = { option: string }

/** Each conversation's choice-card answers, keyed by the card's tool call id. */
export const DecisionAnswersContext = createContext<ReadonlyMap<string, DecisionAnswer>>(new Map())

function choiceOptions(input: unknown): string[] {
  if (parseConnectRequest(input) || parseSecretRequest(input)) return []

  return parseChoiceRequest(input)?.options ?? []
}

/**
 * A card's answer is the first later reply that is one of its options, as
 * choosing one sends it. When several open cards offer it, the newest is the
 * one answered, the same default the reply chip uses. A reply typed in other
 * words answers nothing here, so the card keeps its options.
 */
export function decisionAnswers(messages: readonly Message[]): Map<string, DecisionAnswer> {
  const answers = new Map<string, DecisionAnswer>()
  const open: { id: string; options: string[] }[] = []

  for (const message of messages) {
    if (message.role === 'assistant') {
      for (const part of message.parts) {
        if (part.type !== 'tool' || part.toolName !== 'request_user_decision') continue
        const options = choiceOptions(part.input)

        if (options.length > 0) open.push({ id: part.toolCallId, options })
      }
      continue
    }
    const text = message.parts
      .map((part) => (part.type === 'text' ? part.text : ''))
      .join('')
      .trim()
    const index = open.findLastIndex((entry) => entry.options.includes(text))

    if (index < 0) continue
    // Answered once: a later reply goes to another card.
    const [card] = open.splice(index, 1)

    answers.set(card.id, { option: text })
  }

  return answers
}
