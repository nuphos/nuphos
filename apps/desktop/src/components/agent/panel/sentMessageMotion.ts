// Renderer-only receipts: historical messages and server replays never register.
// Keep this bounded even if a background conversation never mounts its message.
const pending = new Map<string, number>()
const MAX_PENDING = 100
const FRESH_MS = 1_000

export function markMessageSent(id: string) {
  pending.set(id, Date.now())
  if (pending.size > MAX_PENDING) {
    const oldest = pending.keys().next().value

    if (oldest !== undefined) pending.delete(oldest)
  }
}

export function consumeSentMessageMotion(id: string): boolean {
  const sentAt = pending.get(id)

  pending.delete(id)

  return sentAt !== undefined && Date.now() - sentAt < FRESH_MS
}
