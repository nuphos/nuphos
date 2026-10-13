import { parseMessageMetadata } from './messageMetadata.ts'
import { normalizeTransferUploadPart } from './parts.ts'

import type { Message, Tab } from './model.ts'
import type { Part, SteeringPart } from './parts.ts'

export function parseSteeringPart(value: unknown): SteeringPart | null {
  if (!value || typeof value !== 'object') return null
  const { type, data } = value as Record<string, unknown>

  if (type !== 'data-steering' || !data || typeof data !== 'object') return null
  const { id, text, upload, metadata } = data as Record<string, unknown>

  if (typeof id !== 'string' || typeof text !== 'string') return null
  const files =
    upload && typeof upload === 'object'
      ? normalizeTransferUploadPart(upload as Record<string, unknown>)
      : null
  const sender = parseMessageMetadata(metadata)

  return {
    type: 'data-steering',
    data: {
      id,
      text,
      ...(files ? { upload: files } : {}),
      ...(sender ? { metadata: sender } : {}),
    },
  }
}

/** The receipt as the user's message: its files show as a card instead of the text naming them. */
export function steeringMessage({ id, text, upload, metadata }: SteeringPart['data']): Message {
  // The backend names the files in the text's last paragraph (`steeringText`).
  const typed = upload ? text.slice(0, Math.max(0, text.lastIndexOf('\n\n'))) : text
  const parts: Part[] = [
    ...(typed ? [{ type: 'text' as const, text: typed }] : []),
    ...(upload ? [upload] : []),
  ]

  return { id, role: 'user', parts, ...(metadata ? { metadata } : {}) }
}

const isReceipt =
  (id: string) =>
  (part: Part): part is SteeringPart =>
    part.type === 'data-steering' && part.data.id === id

/** Preserve the live assistant/tool target; the runtime receipt is an inline boundary. */
export function appendSteering(tab: Tab, part: SteeringPart): Tab {
  const existing = tab.messages.flatMap((message) => message.parts).find(isReceipt(part.data.id))

  if (existing) {
    return existing.data.metadata || !part.data.metadata ? tab : attributeSteering(tab, part)
  }
  const messages = [...tab.messages]
  const assistant = messages.at(-1)

  if (assistant?.role !== 'assistant') return tab
  messages[messages.length - 1] = { ...assistant, parts: [...assistant.parts, part] }

  return { ...tab, messages }
}

// The API acknowledgement and the stream receipt race; whichever lands second
// may be the one carrying the sender.
function attributeSteering(tab: Tab, incoming: SteeringPart): Tab {
  const matches = isReceipt(incoming.data.id)
  const attribute = (part: Part): Part =>
    matches(part) ? { ...part, data: { ...part.data, metadata: incoming.data.metadata } } : part

  return {
    ...tab,
    messages: tab.messages.map((message) =>
      message.parts.some(matches) ? { ...message, parts: message.parts.map(attribute) } : message,
    ),
  }
}
