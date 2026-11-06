import { t } from '../../i18n/index.ts'
import { stripMarkdown } from '../../lib/agentStopNotification.ts'

import type { AgentConversation } from '../../api/agent-types'

/** A chat row's one-line preview, iMessage style: `Ann: text`, or `Attachment` for files only. */
export function chatPreview(lastMessage: AgentConversation['lastMessage']): string | undefined {
  if (!lastMessage) return undefined
  const text = stripMarkdown(lastMessage.text) || t('Attachment')

  return lastMessage.from ? `${lastMessage.from}: ${text}` : text
}

const DAY_MS = 86_400_000

/**
 * When a chat was last active, as iMessage's list says it: the time today,
 * "Yesterday", the weekday within a week, else the date.
 */
export function chatTime(iso: string, now = new Date()): string | undefined {
  const at = new Date(iso)

  if (Number.isNaN(at.getTime())) return undefined
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((midnight(now) - midnight(at)) / DAY_MS)

  if (days <= 0) return at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (days === 1) {
    const yesterday = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(-1, 'day')

    return yesterday.charAt(0).toLocaleUpperCase() + yesterday.slice(1)
  }
  if (days < 7) return at.toLocaleDateString(undefined, { weekday: 'long' })

  return at.toLocaleDateString(undefined, { year: '2-digit', month: 'numeric', day: 'numeric' })
}
