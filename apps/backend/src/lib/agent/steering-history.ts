import { parseMessageMetadata } from './message-metadata'

/** How a persisted mid-turn user receipt reads in model-facing history. */
export function steeringHistoryText(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const receipt = data as Record<string, unknown>

  if (typeof receipt.text !== 'string') return null
  const who = parseMessageMetadata(receipt.metadata)?.sender.displayName ?? 'User'

  return `\n${who} (during this turn): ${receipt.text}\nAssistant continues:`
}
