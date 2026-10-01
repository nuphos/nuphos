import type { AgentMemoryItem, AgentMemoryScope } from '../../api'

export type LoadState =
  | { kind: 'loading' }
  | {
      kind: 'ready'
      enabled: boolean
      memories: AgentMemoryItem[]
      nextCursor: string | null
      hasMore: boolean
    }
  | { kind: 'error'; message: string }

export type MenuState = {
  memory: AgentMemoryItem
  x: number
  y: number
}

export const PAGE_SIZE = 50

export const tabs: { scope: AgentMemoryScope; label: string }[] = [
  { scope: 'personal', label: 'Personal' },
  { scope: 'team', label: 'Team shared' },
]
