import { createContext } from 'react'

export type ConnectorHeader = { title: string; back?: () => void; manage?: () => void }
export const ConnectorHeaderContext = createContext<
  ((header: ConnectorHeader | null) => void) | null
>(null)
