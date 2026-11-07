import { t } from '../../i18n/index.ts'
import { parseMessageMetadata } from '../agent/panel/messageMetadata.ts'

import type { AgentMessageReply, AgentPersistedMessage } from '../../api/agent-types'

/** A post's words. */
export function textOf(message: AgentPersistedMessage): string {
  return message.parts
    .flatMap((part) => {
      const { type, text } = part as { type?: unknown; text?: unknown }

      return type === 'text' && typeof text === 'string' ? [text] : []
    })
    .join('\n')
}

/** What a reply to this post quotes until the channel stores its own snapshot. */
export function replyTo(message: AgentPersistedMessage): AgentMessageReply | null {
  const sender = parseMessageMetadata(message.metadata)?.sender

  return sender
    ? {
        id: message.id,
        authorName: sender.displayName,
        text: Array.from(textOf(message).trim()).slice(0, 200).join('') || t('File'),
      }
    : null
}

/** Scrolls to a post and flashes it, if it is loaded; a removed one stays put. */
export function jumpTo(id: string) {
  const post = document.querySelector<HTMLElement>(`[data-post-id="${CSS.escape(id)}"]`)

  if (!post) return
  post.scrollIntoView({ block: 'center', behavior: 'smooth' })
  post.classList.remove('cell-flash')
  requestAnimationFrame(() => post.classList.add('cell-flash'))
}
