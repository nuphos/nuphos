import { createContext } from 'react'

import {
  parseChoiceRequest,
  parseConnectRequest,
  parseSecretRequest,
  secretSavedReply,
} from './connectCardModel.ts'
import { answersForm, formQuestions } from './decisionFormModel.ts'

import type { Message } from './model'

/** The option a choice card was answered with, or a secret card's saved reply, from the reply stored in the transcript. */
export type DecisionAnswer = { option: string }

/** Each conversation's choice and secret card answers, keyed by the card's tool call id. */
export const DecisionAnswersContext = createContext<ReadonlyMap<string, DecisionAnswer>>(new Map())

/** Which replies answer a card: one of a choice card's options, or a secret card's saved reply. */
function answeredBy(input: unknown): ((text: string) => boolean) | null {
  if (parseConnectRequest(input)) return null
  const secret = parseSecretRequest(input)

  if (secret) return (text) => text.startsWith(secretSavedReply(secret.name))
  const choice = parseChoiceRequest(input)
  const form = choice && formQuestions(choice)

  if (form) return (text) => answersForm(form, text)
  const options = choice?.options ?? []

  return options.length > 0 ? (text) => options.includes(text) : null
}

/**
 * A card's answer is the first later reply that is one of its options, as
 * choosing one sends it, or for a secret card the reply its saved value sends. When several open cards offer it, the newest is the
 * one answered, the same default the reply chip uses. A reply typed in other
 * words answers nothing here, so the card keeps its options.
 */
export function decisionAnswers(messages: readonly Message[]): Map<string, DecisionAnswer> {
  const answers = new Map<string, DecisionAnswer>()
  const open: { id: string; matches: (text: string) => boolean }[] = []

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
    const index = open.findLastIndex((entry) => entry.matches(text))

    if (index < 0) continue
    // Answered once: a later reply goes to another card.
    const [card] = open.splice(index, 1)

    answers.set(card.id, { option: text })
  }

  return answers
}
