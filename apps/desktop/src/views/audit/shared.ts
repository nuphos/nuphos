import type {
  AgentAuditConversationRow,
  AgentAuditEvent,
  AgentAuditUser,
  RuntimeImageAuditEvent,
  SkillAuditEvent,
} from '../../api'
import type { JournalChatTarget } from '../../lib/journalEvent'

export type SelectedJournal = {
  sessionId: string
  focusTarget: JournalChatTarget | null
  /** eventId the panel was opened from (events tab) — keys the toggle-off. */
  focusEventId: string | null
}

export type Scope = 'mine' | 'team'
export type Tab = 'conversations' | 'events'
export type Range = '24h' | '7d' | '30d' | 'all'

export const RANGE_LABEL: Record<Range, string> = {
  '24h': 'Last 24h',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  all: 'All time',
}

export function rangeFrom(range: Range): string | undefined {
  if (range === 'all') return undefined
  const hours = range === '24h' ? 24 : range === '7d' ? 24 * 7 : 24 * 30

  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
}

export type ConversationsState =
  | { kind: 'loading' }
  | {
      kind: 'ready'
      rows: AgentAuditConversationRow[]
      users: Record<string, AgentAuditUser>
      nextCursor: string | null
    }
  | { kind: 'error'; message: string }

export type EventsState =
  | { kind: 'loading' }
  | {
      kind: 'ready'
      events: AgentAuditEvent[]
      conversations: Record<string, { title: string; ownerUserId?: string | null }>
      users: Record<string, AgentAuditUser>
      nextCursor: string | null
    }
  | { kind: 'error'; message: string }

export function userLabel(users: Record<string, AgentAuditUser>, userId: string | null): string {
  if (!userId) return 'System / import'
  const user = users[userId]

  return user?.name || user?.username || userId.slice(0, 8)
}

export function isSkillAuditEvent(event: AgentAuditEvent): event is SkillAuditEvent {
  return event.kind === 'skill'
}

export function isRuntimeImageAuditEvent(event: AgentAuditEvent): event is RuntimeImageAuditEvent {
  return event.kind === 'runtime_image'
}
