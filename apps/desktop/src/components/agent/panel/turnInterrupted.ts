import type { Tab } from './model.ts'
import type { TurnInterruptedPart } from './parts.ts'

export function normalizeTurnInterruptedReason(value: unknown): TurnInterruptedPart['reason'] {
  return value === 'cancelled' || value === 'timeout' ? value : 'error'
}

export function normalizeTurnInterruptedPart(
  value: Record<string, unknown>,
): TurnInterruptedPart | null {
  if (
    value.type !== 'turn-interrupted' ||
    typeof value.id !== 'string' ||
    typeof value.message !== 'string' ||
    typeof value.createdAt !== 'string'
  ) {
    return null
  }

  return {
    type: 'turn-interrupted',
    id: value.id,
    reason: normalizeTurnInterruptedReason(value.reason),
    message: value.message,
    createdAt: value.createdAt,
  }
}

/** Attach the notice to the current answer, opening one if the stream has none yet. */
export function appendTurnInterruptedPart(
  tab: Tab,
  part: TurnInterruptedPart,
  newMessageId: () => string,
): Tab {
  const messages = tab.messages.slice()
  let assistant = messages[messages.length - 1]

  if (assistant?.role !== 'assistant') {
    assistant = { id: newMessageId(), role: 'assistant', parts: [] }
    messages.push(assistant)
  }
  const parts = assistant.parts.filter((p) => !(p.type === 'turn-interrupted' && p.id === part.id))

  messages[messages.length - 1] = { ...assistant, parts: [...parts, part] }

  return { ...tab, connected: true, messages }
}
