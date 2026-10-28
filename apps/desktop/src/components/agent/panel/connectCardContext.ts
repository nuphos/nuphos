import { createContext } from 'react'

import type { CredentialSelectorControl } from './credentialSections'
import type { DecisionCardRef } from './replyTarget'

export type ConnectCardContextValue = {
  // The conversation's credential picker; absent where the viewer cannot change it.
  credentials?: CredentialSelectorControl
  /** The card says what it asked, to find its open request when the ids differ. */
  send: (text: string, card: DecisionCardRef) => void
  // Writes a secret to a file on the agent's runtime and returns its path; absent when read-only.
  saveSecret?: (name: string, value: string) => Promise<string>
}

export const ConnectCardContext = createContext<ConnectCardContextValue | null>(null)
