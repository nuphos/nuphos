import type { PersonalCredentialProvider } from '../types/team.ts'

/** The desktop a `computer` request hands over: its Box, its X display, and the title its card shows. */
export type ComputerDesktop = { deviceId: string; display: number; title: string }

/** A `computer` card's own answers: hand the desktop back, or skip the step. */
export const COMPUTER_OPTIONS = ["I'm done", 'Skip'] as const

/** A question an agent asked with request_user_decision, as the conversation keeps it while open. */
export type AgentInputRequest = {
  /** The request_user_decision tool call id. */
  id: string
  category: string
  question: string
  /** Markdown the agent wrote so the question can be decided without the chat. */
  body?: string
  options?: string[]
  /** Any number of `options` may be picked. */
  multiSelect?: boolean
  /** Related questions answered together; `question` is their headline. */
  questions?: { question: string; options?: string[]; multiSelect?: boolean }[]
  /** The secret a `credential` request asks for, the providers an `integration` one connects (any access) or the member's own credentials it asks for (only selecting one answers), or the plan it approves. */
  secretName?: string
  /** The details a `credential` request asks for in one card, and the site they are entered on. */
  fields?: { name: string; label: string }[]
  site?: string
  providers?: string[]
  credentials?: { provider: 'personal'; id: PersonalCredentialProvider }[]
  planId?: string
  /** The desktop a `computer` request hands over. */
  desktop?: ComputerDesktop
  askedAt: string
  /** Set aside by its owner: out of the Inbox until then (ISO), still answerable in its chat. */
  snoozedUntil?: string
  /** When the agent last rewrote it with update_user_decision. */
  updatedAt?: string
  status: 'open' | 'answered' | 'dismissed'
}
