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

  if (elapsedMs < minute) return 'now'
  if (elapsedMs < hour) {
    const minutes = Math.max(1, Math.floor(elapsedMs / minute))

    return `${String(minutes)} min`
  }
  if (elapsedMs < day) {
    const hours = Math.max(1, Math.floor(elapsedMs / hour))

    return `${String(hours)} ${hours === 1 ? 'hr' : 'hrs'}`
  }
  if (elapsedMs < month) {
    const days = Math.max(1, Math.floor(elapsedMs / day))

    return `${String(days)} ${days === 1 ? 'day' : 'days'}`
  }
  if (elapsedMs < year) {
    const months = Math.max(1, Math.floor(elapsedMs / month))

    return `${String(months)} ${months === 1 ? 'mo' : 'mos'}`
  }
  const years = Math.max(1, Math.floor(elapsedMs / year))

  return `${String(years)} ${years === 1 ? 'yr' : 'yrs'}`
}

export function conversationOwnerName(conversation: AgentConversation): string {
  return conversation.owner?.name || conversation.owner?.email || 'User'
}
