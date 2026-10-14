import { createContext } from 'react'

import type { CredentialSelectorControl } from './credentialSections'

export type ConnectCardContextValue = {
  // The conversation's credential picker; absent where the viewer cannot change it.
  credentials?: CredentialSelectorControl
  send: (text: string) => void
}

export const ConnectCardContext = createContext<ConnectCardContextValue | null>(null)
