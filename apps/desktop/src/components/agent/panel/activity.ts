import { isPlainToolPart } from './toolRuns.ts'

import type { Message } from './model.ts'
import type { Part } from './parts.ts'

export function failedOutput(output: unknown): boolean {
  if (!output || typeof output !== 'object') return false
  const value = output as Record<string, unknown>

  return (
    value.isError === true ||
    [value.exitCode, value.exit_code].some((code) => typeof code === 'number' && code !== 0)
  )
}

export function isRoutineActivity(part: Part): boolean {
  if (part.type === 'text') return !part.text.trim() || part.phase === 'commentary'
  if (part.type === 'reasoning' || part.type === 'step-start') return true
  if (!isPlainToolPart(part) || part.state !== 'output-available') return false

  return (
    !failedOutput(part.output) &&
    !(part.authorization?.decision === 'require_auth' && !part.authorization.resolved)
  )
}

export function liveActivityIndices(parts: Part[]): Set<number> {
  if (parts.some((part) => part.type === 'data-steering' || part.type === 'turn-interrupted'))
    return new Set()
  const latestText = parts.findLastIndex(
    (part) => part.type === 'text' && Boolean(part.text.trim()),
  )
  const history = new Set<number>()

  parts.forEach((part, index) => {
    if (index === latestText || index === parts.length - 1 || !isRoutineActivity(part)) return
    history.add(index)
  })

  return history
}

// Keep message identity and content intact: only the placement changes.
export function conversationActivity(
  messages: Message[],
  protectedIds: ReadonlySet<string> = new Set(),
  boundaryIds: ReadonlySet<string> = new Set(),
) {
  const hidden = new Set<string>()
  const before = new Map<string, Message[]>()
  const latestText = new Set<string>()
  let lastText: Message | undefined

  for (const message of messages) {
    if (message.role === 'user') {
      if (lastText) latestText.add(lastText.id)
      lastText = undefined
    } else if (message.parts.some((part) => part.type === 'text' && part.text.trim()))
      lastText = message
  }
  if (lastText) latestText.add(lastText.id)
  let pending: Message[] = []

  messages.forEach((message, index) => {
    if (message.role === 'user' || boundaryIds.has(message.id)) {
      pending = []

      return
    }
    const eligible =
      index < messages.length - 1 &&
      !protectedIds.has(message.id) &&
      !latestText.has(message.id) &&
      !message.stoppedByUser &&
      message.parts.length > 0 &&
      message.parts.every(isRoutineActivity)

    if (eligible) pending.push(message)
    else if (pending.length) {
      before.set(message.id, pending)
      pending.forEach((entry) => hidden.add(entry.id))
      pending = []
    }
  })

  return { hidden, before }
}
