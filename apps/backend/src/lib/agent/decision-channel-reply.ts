// What an answer to a question card leaves in the channel it was asked in.
import { randomUUID } from 'node:crypto'

import {
  appendConversationMessages,
  bumpConversationActivity,
  getConversationBySessionId,
} from './db'

import type { AgentConversation } from './db'
import type { InputRequest } from './db/pending-decision'
import type { MessageMetadata } from './message-metadata'

/** What a person picked or typed: for one question, or per question of a card that asks several. */
export type DecisionAnswer = {
  choices?: string[]
  text?: string
  questions?: { choices?: string[]; text?: string }[]
  /** Given in the Inbox, not on the card where it was asked. */
  answeredIn?: 'inbox'
}

/** The person answering, as their posts name them. */
export type Actor = { id: string; displayName: string; avatarURL?: string }

function said({ choices, text }: { choices?: string[]; text?: string }): string {
  return text?.trim() || choices?.join(', ') || '(no answer)'
}

/** Each question the card asked, with what was said to it. */
export function answered(request: InputRequest, answer: DecisionAnswer) {
  const questions = request.questions ?? []

  if (!questions.length) return [{ question: request.question, said: said(answer) }]

  return questions.map((question, index) => ({
    question: question.question,
    said: said(answer.questions?.[index] ?? {}),
  }))
}

/**
 * The answer in the channel the question was asked in: the person's reply to
 * each question, as their own post. Written here, not posted, so it wakes no
 * one: the agent that asked already has it.
 */
export async function recordInChannel(
  asker: AgentConversation,
  request: InputRequest,
  answer: DecisionAnswer,
  actor: Actor,
) {
  const channel = request.channelId ? await getConversationBySessionId(request.channelId) : null

  if (!channel?.teamId) return
  const sentAt = new Date().toISOString()
  const sender = {
    type: 'user' as const,
    id: actor.id,
    displayName: actor.displayName,
    ...(actor.avatarURL ? { avatarURL: actor.avatarURL } : {}),
  }

  await appendConversationMessages({
    sessionId: channel.sessionId,
    userId: channel.userId,
    teamId: channel.teamId,
    messages: answered(request, answer).map((entry) => ({
      id: randomUUID(),
      role: 'user',
      parts: [{ type: 'text', text: entry.said }],
      metadata: {
        version: 1,
        sender,
        source: 'nuphos',
        sentAt,
        replyTo: { authorName: asker.title || 'Nuphos agent', text: entry.question },
        requestId: request.id,
        ...(answer.answeredIn ? { answeredIn: answer.answeredIn } : {}),
      } satisfies MessageMetadata,
    })),
  })
  await bumpConversationActivity(channel.sessionId, channel.userId)
}
