import { createContext } from 'react'

import type { CredentialSelectorControl } from './credentialSections'

export type ConnectCardContextValue = {
  // The conversation's credential picker; absent where the viewer cannot change it.
  credentials?: CredentialSelectorControl
  /** `question`: the card's question, to find its open request when the ids differ. */
  send: (text: string, toolCallId: string, question?: string) => void
  // Writes a secret to a file on the agent's runtime and returns its path; absent when read-only.
  saveSecret?: (name: string, value: string) => Promise<string>
}

export const ConnectCardContext = createContext<ConnectCardContextValue | null>(null)
