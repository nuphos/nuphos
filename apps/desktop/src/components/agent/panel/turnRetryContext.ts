import { createContext } from 'react'

/** Resends the latest failed turn's prompt; null where there is nothing the viewer may resend. */
export const TurnRetryContext = createContext<(() => void) | null>(null)
