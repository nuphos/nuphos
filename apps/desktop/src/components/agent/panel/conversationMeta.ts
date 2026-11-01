import { t } from '../../../i18n/index.ts'

import type { AgentConversation } from '../../../api'

export function formatHistoryTime(value: string): string {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) return ''
  const elapsedMs = Math.max(0, Date.now() - date.getTime())
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  const month = 30 * day
  const year = 365 * day

  // 'now' stays English: archivedChatsList compares it. Callers translate it.
  if (elapsedMs < minute) return 'now'
  if (elapsedMs < hour) {
    const minutes = Math.max(1, Math.floor(elapsedMs / minute))

    return t('{n} min', { n: minutes })
  }
  if (elapsedMs < day) {
    const hours = Math.max(1, Math.floor(elapsedMs / hour))

    return hours === 1 ? t('1 hr') : t('{n} hrs', { n: hours })
  }
  if (elapsedMs < month) {
    const days = Math.max(1, Math.floor(elapsedMs / day))

    return days === 1 ? t('1 day') : t('{n} days', { n: days })
  }
  if (elapsedMs < year) {
    const months = Math.max(1, Math.floor(elapsedMs / month))

    return months === 1 ? t('1 mo') : t('{n} mos', { n: months })
  }
  const years = Math.max(1, Math.floor(elapsedMs / year))

  return years === 1 ? t('1 yr') : t('{n} yrs', { n: years })
}

export function conversationOwnerName(conversation: AgentConversation): string {
  return conversation.owner?.name || conversation.owner?.email || t('User')
}
