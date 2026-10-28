import { MessageSquare, SquarePen } from 'lucide-react'

import { teamOverviewNavItemFor } from '../../lib/teamOverviewNav.ts'

import type { AgentConversation } from '../../api/agent-types'
import type { SurfaceEntry } from '../../app/workspace/store/workspaceState'
import type { LucideIcon } from 'lucide-react'

/** The main pane's Back/Forward timeline as the sidebar's history menu reads it. */
export type HistoryTimeline = {
  entries: readonly SurfaceEntry[]
  index: number
  onJump: (index: number) => void
}

export type HistoryRow = {
  /** Position in the timeline, to jump to. */
  index: number
  label: string
  at: number
  current: boolean
} & ({ icon: LucideIcon } | { /** A chat, shown with its agent's avatar. */ chat: ChatRef })

/** A listed chat, or just its ID when the list does not hold it. */
type ChatRef = Pick<AgentConversation, 'sessionId' | 'avatar' | 'agentRuntime'>

/** The chat the sidebar lists under this ID, if any. */
export type ChatLookup = (sessionId: string) => AgentConversation | undefined

/** How many places a right-click on Back or Forward lists, like a browser. */
export const HISTORY_MENU_LIMIT = 5

function historyRow(
  entry: SurfaceEntry,
  index: number,
  cursor: number,
  chatOf: ChatLookup,
): HistoryRow {
  const base = { index, at: entry.at, current: index === cursor }

  if (entry.mainPageOpen) {
    const item = entry.page ? teamOverviewNavItemFor(entry.page.active) : undefined

    return { ...base, label: item?.label ?? 'Page', icon: item?.icon ?? MessageSquare }
  }
  if (entry.sessionId === null) return { ...base, label: 'New chat', icon: SquarePen }
  const chat = chatOf(entry.sessionId)

  return {
    ...base,
    label: chat?.title || chat?.firstMessage || 'Untitled chat',
    chat: chat ?? { sessionId: entry.sessionId },
  }
}

/** The places Back (`-1`) or Forward (`1`) would visit, nearest first. */
export function historyMenuRows(
  timeline: Pick<HistoryTimeline, 'entries' | 'index'>,
  direction: -1 | 1,
  chatOf: ChatLookup,
): HistoryRow[] {
  const rows: HistoryRow[] = []

  for (
    let index = timeline.index + direction;
    index >= 0 && index < timeline.entries.length && rows.length < HISTORY_MENU_LIMIT;
    index += direction
  ) {
    rows.push(historyRow(timeline.entries[index], index, timeline.index, chatOf))
  }

  return rows
}

/** The whole timeline, newest first, for "Show full history". */
export function fullHistoryRows(
  timeline: Pick<HistoryTimeline, 'entries' | 'index'>,
  chatOf: ChatLookup,
): HistoryRow[] {
  return timeline.entries
    .map((entry, index) => historyRow(entry, index, timeline.index, chatOf))
    .reverse()
}

export function historyAge(at: number, now = Date.now()): string {
  const minutes = Math.floor((now - at) / 60_000)

  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${String(minutes)}m ago`
  const hours = Math.floor(minutes / 60)

  return hours < 24 ? `${String(hours)}h ago` : `${String(Math.floor(hours / 24))}d ago`
}
