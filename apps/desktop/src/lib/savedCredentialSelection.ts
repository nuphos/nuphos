import type { AgentCredentialSelection } from '../api'

/** A conversation's credential selection, as the server stored it. */
export type SavedSelection = { sessionId: string; credentialAccess: AgentCredentialSelection }

// A selection saved outside the conversation's own picker (an Inbox card, a Bot's
// chat): the Task panel holding that conversation open takes it from here.
const listeners = new Set<(saved: SavedSelection) => void>()

export function announceSavedSelection(saved: SavedSelection): void {
  for (const listener of listeners) listener(saved)
}

export function onSavedSelection(listener: (saved: SavedSelection) => void): () => void {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}
