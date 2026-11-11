import { createContext } from 'react'

import type { CredentialSelectorControl } from './credentialSections'
import type { DecisionCardRef, ReplyQuestion } from './replyTarget'

export type ConnectCardContextValue = {
  // The conversation's credential picker; absent where the viewer cannot change it.
  credentials?: CredentialSelectorControl
  /**
   * A card says what it asked, to find its open request when the ids differ.
   * Without one it is a plain message, as when a failed one is sent again.
   */
  send: (text: string, card?: DecisionCardRef) => void
  // Writes a secret to a file on the agent's runtime and returns its path; absent when read-only.
  saveSecret?: (name: string, value: string) => Promise<string>
  // The conversation's open questions once listed: a card asking one can still be answered.
  openQuestions?: readonly ReplyQuestion[]
  // Starts a typed answer to the card's question in the composer; absent where none answers it.
  reply?: (card: DecisionCardRef) => void
  // Shows a question's body in full, where the card is the page it is read on.
  fullBody?: boolean
}

export const ConnectCardContext = createContext<ConnectCardContextValue | null>(null)
