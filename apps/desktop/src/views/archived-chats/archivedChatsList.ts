import { formatHistoryTime } from '../../components/agent/panel/conversationMeta.ts'

export function archivedAtLabel(archivedAt: string | undefined): string {
  const elapsed = archivedAt ? formatHistoryTime(archivedAt) : ''

  if (!elapsed) return 'Archived'

  return elapsed === 'now' ? 'Archived just now' : `Archived ${elapsed} ago`
}

/** A cursor page can overlap the rows already shown once an unarchive shifts the list. */
export function appendArchivedPage<T extends { sessionId: string }>(
  shown: readonly T[],
  page: readonly T[],
): T[] {
  const seen = new Set(shown.map((row) => row.sessionId))

  return [...shown, ...page.filter((row) => !seen.has(row.sessionId))]
}
