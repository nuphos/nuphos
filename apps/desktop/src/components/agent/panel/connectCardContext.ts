import { createContext } from 'react'

import type { CredentialSelectorControl } from './credentialSections'
import type { DecisionCardRef, ReplyQuestion } from './replyTarget'
import type { DecisionAnswer } from '../../../api/agent-chat-types'

export type ConnectCardContextValue = {
  // The conversation's credential picker; absent where the viewer cannot change it.
  credentials?: CredentialSelectorControl
  /**
   * A card says what it asked, to find its open request when the ids differ.
   * Without one it is a plain message, as when a failed one is sent again.
   */
  send: (text: string, card?: DecisionCardRef) => boolean | void
  /** Answers a card's question: the server wakes the agent that asked it; no message is sent. */
  answer?: (answer: DecisionAnswer, card: DecisionCardRef) => boolean | void | Promise<boolean>
  // Writes a secret to a file on the agent's runtime and returns its path; absent when read-only.
  saveSecret?: (name: string, value: string) => Promise<string>
  // The conversation's open questions once listed: a card asking one can still be answered.
  openQuestions?: readonly ReplyQuestion[]
  // Shows a question's body in full, where the card is the page it is read on.
  fullBody?: boolean
}

export const ConnectCardContext = createContext<ConnectCardContextValue | null>(null)
