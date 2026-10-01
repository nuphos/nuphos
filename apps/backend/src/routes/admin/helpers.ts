export function parseFilterOp(value: string | undefined): 'is' | 'not' | undefined {
  return value === 'not' ? 'not' : undefined
}

export function cleanQuery(value: string | undefined): string | undefined {
  const trimmed = value?.trim()

  return trimmed ? trimmed : undefined
}

export function splitIdList(value: string | undefined): string[] {
  if (!value) return []

  return value
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, 200)
}

export function parseLimit(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)

  if (!Number.isFinite(parsed)) return undefined

  return Math.max(1, Math.min(100, Math.floor(parsed)))
}

export function serializeConversation<T extends { _id?: unknown }>(
  conversation: T,
): Omit<T, '_id'> {
  const { _id, ...rest } = conversation

  return rest as Omit<T, '_id'>
}
