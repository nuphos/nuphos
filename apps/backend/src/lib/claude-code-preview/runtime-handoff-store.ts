// Shared wire record: run-lease cleanup and graceful shutdown feed the same adopter.
export const RUNTIME_HANDOFFS_KEY = 'atlas:agent:runtime-handoffs'

export type RuntimeHandoff = {
  teamId: string
  conversationId: string
  ownerUserId: string
  actorUserId: string
  locale: string
  at: number
  attempts?: number
  /** Crash recovery must never start a fresh session or replace a newer turn. */
  abandonedStreamId?: string
}
