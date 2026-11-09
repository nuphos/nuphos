import { trackSearch } from '../../lib/searchAnalytics'
import { relativeTimeFromNow } from '../agent/panel/textUtils'

import type { SessionResult } from './useSearchResults'

export type OpenedKind = 'bot' | 'task' | 'person' | 'command'

/** What a search led to, and whether by mouse or keyboard: keys aren't autocaptured. */
export function trackOpened(
  kind: OpenedKind,
  position: number,
  method: 'mouse' | 'keyboard',
  query: string,
) {
  trackSearch('search_result_opened', { kind, position, method, query_length: query.length })
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
