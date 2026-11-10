import { MessageCircle } from 'lucide-react'

import { t } from '../../i18n'
import { AgentAvatar } from '../agent/AgentAvatar'
import { Tooltip } from '../ui/tooltip'

import type { Item } from './types'

/**
 * On a Task that is also a Bot: a small chat bubble and the Bot's face, which
 * open its chat. The row keeps its runtime mark, so it stays one agent seen as
 * work, linked to the same agent seen as a chat.
 */
export function BotChatLink({
  link,
  onSelect,
}: {
  link: NonNullable<Item['botChat']>
  onSelect: (key: string) => void
}) {
  const open = () => {
    if (link.key) onSelect(link.key)
    else link.open?.()
  }

  return (
    <Tooltip content={t('Chat with {name}', { name: link.name })}>
      <span
        role="button"
        tabIndex={-1}
        aria-label={t('Chat with {name}', { name: link.name })}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          event.preventDefault()
          open()
        }}
        className="titlebar-no-drag ml-1 inline-flex h-5 flex-shrink-0 items-center gap-0.5 rounded-full border border-line-control py-0.5 pl-1 pr-0.5 text-tertiary transition-colors hover:border-line-focus hover:text-main"
      >
        <MessageCircle className="size-3" strokeWidth={1.8} aria-hidden />
        {/* The face alone: the row already shows the runtime. */}
        <AgentAvatar agentId={link.botId} size={14} bare />
      </span>
    </Tooltip>
  )
}
