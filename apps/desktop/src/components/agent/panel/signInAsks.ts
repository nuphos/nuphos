import { useSyncExternalStore } from 'react'

import type { AgentSignInRequest } from '../../../api/agent-types'

// Asks made from this window: the card says so before the conversation is read again.
const asks = new Map<string, AgentSignInRequest>()
const listeners = new Set<() => void>()

export function rememberSignInAsk(sessionId: string, ask: AgentSignInRequest): void {
  asks.set(sessionId, ask)
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

/** The newer of this window's own ask and the one the server last reported. */
export function useSignInRequest(
  sessionId: string,
  fromServer: AgentSignInRequest | undefined,
): AgentSignInRequest | undefined {
  const local = useSyncExternalStore(subscribe, () => asks.get(sessionId))

  if (!local || !fromServer) return local ?? fromServer

  return Date.parse(local.askedAt) >= Date.parse(fromServer.askedAt) ? local : fromServer
}
