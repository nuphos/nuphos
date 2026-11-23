import { formatHistoryTime } from '../../components/agent/panel/conversationMeta.ts'
import { t } from '../../i18n/index.ts'

export function archivedAtLabel(archivedAt: string | undefined): string {
  const elapsed = archivedAt ? formatHistoryTime(archivedAt) : ''

  if (!elapsed) return t('Archived')

  return elapsed === 'now' ? t('Archived just now') : t('Archived {elapsed} ago', { elapsed })
}
