import { randomBytes, randomUUID } from 'node:crypto'

import type { MessageMetadata } from '@/lib/agent/message-metadata'

export { steeringHistoryText } from '@/lib/agent/steering-history'

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
export type SteeringEntry = { type: 'data-steering'; data: SteeringReceipt }

const ATTACHED = (name: string) => `[Attached: ${name}]`
const ATTACHED_LINE = /^\[Attached: (.+)\]$/
const GROUP_ID = /^[a-f\d]{24}$/
// A UUIDv8: the runtime accepts only UUIDs as steering ids, and version 8 never
// collides with the v4 ids text-only steers get from `randomUUID()`.
const UPLOAD_ID = /^([a-f\d]{12})8([a-f\d]{3})[89ab]([a-f\d]{9})[a-f\d]{6}$/

/** The receipt names attached files, one per line, so the transcript records what was sent. */
export function steeringText(typed: string, fileNames: string[]): string {
  return [typed, fileNames.map(ATTACHED).join('\n')].filter(Boolean).join('\n\n')
}

/** Every steer gets its own UUID; one with files carries its upload group's 24 hex digits. */
export function steeringMessageId(groupId?: string): string {
  if (!groupId || !GROUP_ID.test(groupId)) return randomUUID()
  const random = randomBytes(4).toString('hex')
  const variant = (8 | (parseInt(random[0] ?? '0', 16) & 3)).toString(16)
  const hex = `${groupId.slice(0, 12)}8${groupId.slice(12, 15)}${variant}${groupId.slice(15)}${random.slice(1, 7)}`

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-')
}

function uploadGroupId(id: string): string | undefined {
  const parts = UPLOAD_ID.exec(id.replaceAll('-', ''))

  return parts ? parts.slice(1).join('') : undefined
}

/**
 * The runtime echoes a receipt as id and text only. A steer with files names
 * its upload group in its id (`steeringMessageId`) and each file on a line of
 * the text's last paragraph (`steeringText`), so the receipt can show them again.
 */
export function steeringReceipt(id: string, text: string): SteeringReceipt {
  const receipt = { id, text }
  const groupId = uploadGroupId(id)
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
