import { renderAttributedMessage } from './message-metadata'

/** How a persisted mid-turn receipt reads in model-facing history: with its sender's metadata block. */
export function steeringHistoryText(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const receipt = data as Record<string, unknown>

  if (typeof receipt.text !== 'string') return null
  const id = typeof receipt.id === 'string' ? receipt.id : ''

  return `\nSent during this turn:\n${renderAttributedMessage(id, receipt.text, receipt.metadata)}\nAssistant continues:`
}
