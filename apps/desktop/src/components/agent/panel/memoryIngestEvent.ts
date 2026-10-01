import type { AgentMemoryIngestEventItem } from '../../../api.ts'

export function isAgentMemoryIngestEventItem(value: unknown): value is AgentMemoryIngestEventItem {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>

  return (
    typeof item.id === 'string' &&
    (item.type === 'fact' || item.type === 'artifact' || item.type === 'episode') &&
    (item.title === undefined || typeof item.title === 'string') &&
    typeof item.text === 'string' &&
    Array.isArray(item.categories) &&
    item.categories.every((category) => typeof category === 'string') &&
    Array.isArray(item.scopes) &&
    item.scopes.every((scope) => scope === 'personal' || scope === 'team') &&
    typeof item.createdAt === 'string' &&
    typeof item.updatedAt === 'string'
  )
}
