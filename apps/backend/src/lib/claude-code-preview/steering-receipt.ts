import type { MessageMetadata } from '@/lib/agent/message-metadata'

import { createMessageMetadata } from '@/lib/agent/message-attribution'
import { parseMessageMetadata } from '@/lib/agent/message-metadata'
import { logError } from '@/lib/observability'

/** A mid-turn user instruction the runtime accepted, as stored in the transcript. */
export type SteeringReceipt = { id: string; text: string; metadata?: MessageMetadata }
export type SteeringEntry = { type: 'data-steering'; data: SteeringReceipt; receivedAt: string }
export type SteeringAttribution = (sentAt?: string) => MessageMetadata | undefined

/**
 * The runtime's steering receipt carries only an id and text. Native steering
 * is admitted for the turn's actor alone (`POST /conversations/:id/steer`
 * rejects everyone else), so every receipt in this turn belongs to that actor.
 * A failed lookup is retried on the next receipt, and `attributeReceipt`
 * backfills receipts that arrived before the lookup resolved.
 */
export function createSteeringAttribution(
  actorUserId: string,
  lookup: typeof createMessageMetadata = createMessageMetadata,
): SteeringAttribution {
  let sender: MessageMetadata | undefined
  let inFlight: Promise<void> | null = null
  const resolve = () => {
    inFlight ??= lookup(actorUserId, 'nuphos').then(
      (metadata) => {
        sender = metadata
      },
      (error: unknown) => {
        inFlight = null
        logError('agent.steering.attribution_failed', error, { actor_user_id: actorUserId })
      },
    )
  }

  resolve()

  return (sentAt = new Date().toISOString()) => {
    if (!sender) resolve()

    return sender ? { ...sender, sentAt } : undefined
  }
}

export function attributeReceipt(
  entry: SteeringEntry,
  attribute?: SteeringAttribution,
): { type: 'data-steering'; data: SteeringReceipt } {
  const metadata = entry.data.metadata ?? attribute?.(entry.receivedAt)

  return { type: 'data-steering', data: { ...entry.data, ...(metadata ? { metadata } : {}) } }
}

/** How a persisted receipt reads in the history preamble of a re-created session. */
export function steeringHistoryText(data: Record<string, unknown>): string | null {
  if (typeof data.text !== 'string') return null
  const who = parseMessageMetadata(data.metadata)?.sender.displayName ?? 'User'

  return `\n${who} (during this turn): ${data.text}\nAssistant continues:`
}
