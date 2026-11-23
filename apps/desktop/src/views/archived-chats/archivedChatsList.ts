import { formatHistoryTime } from '../../components/agent/panel/conversationMeta.ts'
import { t } from '../../i18n/index.ts'

export function archivedAtLabel(archivedAt: string | undefined): string {
  const elapsed = archivedAt ? formatHistoryTime(archivedAt) : ''

  if (!elapsed) return t('Archived')

  return elapsed === 'now' ? t('Archived just now') : t('Archived {elapsed} ago', { elapsed })
}

/** A cursor page can overlap the rows already shown once an unarchive shifts the list. */
export function appendArchivedPage<T extends { sessionId: string }>(
  shown: readonly T[],
  page: readonly T[],
): T[] {
  const seen = new Set(shown.map((row) => row.sessionId))

  return [...shown, ...page.filter((row) => !seen.has(row.sessionId))]
}
