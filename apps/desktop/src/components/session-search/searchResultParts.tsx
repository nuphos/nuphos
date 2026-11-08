import { track } from '../../lib/analytics'
import { relativeTimeFromNow } from '../agent/panel/textUtils'

import type { SessionResult } from './useSearchResults'

type OpenedKind = 'bot' | 'task' | 'person' | 'command'

/** What a search led to, and whether by mouse or keyboard: keys aren't autocaptured. */
export function trackOpened(
  kind: OpenedKind,
  position: number,
  method: 'mouse' | 'keyboard',
  query: string,
) {
  track('search_result_opened', { kind, position, method, query_length: query.length })
}

export const kindOf = ({ conversation }: SessionResult): OpenedKind =>
  conversation.kind === 'channel' ? 'bot' : 'task'

export function metaFor({ conversation, openedAt }: SessionResult, userId: string) {
  const time = relativeTimeFromNow(
    openedAt ? new Date(openedAt).toISOString() : conversation.lastActiveAt,
  )
  const owner = conversation.owner

  if (!owner || owner.id === userId) return time

  return `${owner.name || owner.email} · ${time}`
}

/** A group's name over its rows, as the sidebar titles its groups. */
export function GroupLabel({ text }: { text: string }) {
  return (
    <div className="px-2.5 pt-3 pb-1 text-[12.5px] text-tertiary" role="presentation">
      {text}
    </div>
  )
}

/** Placeholder rows hold the list's shape while it loads, so nothing jumps. */
export function ResultSkeleton() {
  return (
    <div aria-hidden className="space-y-0.5 px-2 pt-3">
      {[64, 48, 72, 56, 40].map((width) => (
        <div key={width} className="flex h-10 items-center gap-2.5 px-2.5">
          <span className="size-6 shrink-0 rounded-md bg-state-hover" />
          <span className="h-3 rounded bg-state-hover" style={{ width: `${String(width)}%` }} />
        </div>
      ))}
    </div>
  )
}
