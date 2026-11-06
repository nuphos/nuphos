import { t } from '../../i18n/index.ts'
import { stripMarkdown } from '../../lib/agentStopNotification.ts'

import type { AgentConversation } from '../../api/agent-types'

/** A chat row's one-line preview, iMessage style: `Ann: text`, or `Attachment` for files only. */
export function chatPreview(lastMessage: AgentConversation['lastMessage']): string | undefined {
  if (!lastMessage) return undefined
  const text = stripMarkdown(lastMessage.text) || t('Attachment')

  return lastMessage.from ? `${lastMessage.from}: ${text}` : text
}
