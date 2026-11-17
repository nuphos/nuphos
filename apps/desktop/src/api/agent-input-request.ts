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
  credentials?: { provider: 'personal'; id: 'github' | 'linear' }[]
  planId?: string
  askedAt: string
  /** Set aside by its owner: out of the Inbox until then (ISO), still answerable in its chat. */
  snoozedUntil?: string
  status: 'open' | 'answered' | 'dismissed'
}
