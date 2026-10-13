import { randomUUID } from 'node:crypto'

import type { MessageMetadata } from '@/lib/agent/message-metadata'

import { createMessageMetadata } from '@/lib/agent/message-attribution'
import { parseMessageMetadata } from '@/lib/agent/message-metadata'
import { logError } from '@/lib/observability'

/** The desktop's `transfer-upload` part, so a receipt shows its files like any user message. */
type SteeringUpload = {
  type: 'transfer-upload'
  groupId: string
  status: 'ready'
  files: { fileName: string; size: null; status: 'ready' }[]
}

/** A mid-turn user instruction the runtime accepted, as stored in the transcript. */
export type SteeringReceipt = {
  id: string
  text: string
  upload?: SteeringUpload
  metadata?: MessageMetadata
}
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

const ATTACHED = (name: string) => `[Attached: ${name}]`
const ATTACHED_LINE = /^\[Attached: (.+)\]$/
const UPLOAD_ID = /^([a-f\d]{24})\./i

/** The receipt names attached files, one per line, so the transcript records what was sent. */
export function steeringText(typed: string, fileNames: string[]): string {
  return [typed, fileNames.map(ATTACHED).join('\n')].filter(Boolean).join('\n\n')
}

/** Every steer gets its own id; one with files carries its upload group's id in front. */
export function steeringMessageId(groupId?: string): string {
  return groupId ? `${groupId}.${randomUUID()}` : randomUUID()
}

/**
 * The runtime echoes a receipt as id and text only. A steer with files names
 * its upload group in its id (`steeringMessageId`) and each file on a line of
 * the text's last paragraph (`steeringText`), so the receipt can show them again.
 */
export function steeringReceipt(
  id: string,
  text: string,
  metadata?: MessageMetadata,
): SteeringReceipt {
  const receipt = { id, text, ...(metadata ? { metadata } : {}) }
  const groupId = UPLOAD_ID.exec(id)?.[1]
  const names = (text.split('\n\n').at(-1) ?? '')
    .split('\n')
    .map((line) => ATTACHED_LINE.exec(line)?.[1])

  if (!groupId || names.some((name) => name === undefined)) return receipt

  return {
    ...receipt,
    upload: {
      type: 'transfer-upload',
      groupId,
      status: 'ready',
      files: (names as string[]).map((fileName) => ({ fileName, size: null, status: 'ready' })),
    },
  }
}

/** How a persisted receipt reads in the history preamble of a re-created session. */
export function steeringHistoryText(data: Record<string, unknown>): string | null {
  if (typeof data.text !== 'string') return null
  const who = parseMessageMetadata(data.metadata)?.sender.displayName ?? 'User'

  return `\n${who} (during this turn): ${data.text}\nAssistant continues:`
}
