import clsx from 'clsx'
import { ArrowUpRight } from 'lucide-react'

import { AgentAvatar } from '../../components/agent/AgentAvatar'
import { chatTime } from '../../components/sidebar/chat-preview'
import { t } from '../../i18n'

import { inboxGroups, inboxSource } from './inboxItems'

import type { InboxQuestion } from './inboxItems'
import type { AgentConversation } from '../../api/agent-types'

type Source = Pick<AgentConversation, 'sessionId' | 'title' | 'avatar' | 'agentRuntime'>

/**
 * The Inbox's list in the sidebar: the open questions grouped by the Bot or
 * Task that asked, under its face or its Runtime's icon, one line each.
 * A question from a Bot's task is in the Bot's group, followed by the task's name.
 */
export function QuestionRail({
  rows,
  openId,
  onSelect,
}: {
  rows: readonly InboxQuestion[]
  openId: string | undefined
  onSelect: (row: InboxQuestion) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      {inboxGroups(rows).map((group) => {
        const conversation = inboxSource(group[0])

        return (
          <section key={conversation.sessionId} className="flex flex-col gap-px">
            <h3 className="flex h-7 items-center gap-2 px-2 text-[12.5px] font-medium text-main">
              <QuestionSourceIcon conversation={conversation} />
              <span className="truncate">{conversation.title || t('Untitled task')}</span>
            </h3>
            {group.map((row) => (
              <button
                key={row.request.id}
                type="button"
                aria-current={row.request.id === openId ? 'true' : undefined}
                data-inbox-question={row.request.id}
                onClick={() => onSelect(row)}
                className={clsx(
                  'h-7 truncate rounded-md pl-8 pr-2 text-left text-[13px] outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-line-focus',
                  row.request.id === openId
                    ? 'bg-state-selected text-main'
                    : 'text-secondary hover:bg-state-hover hover:text-main',
                )}
              >
                {row.request.question}
                {row.bot && (
                  <span className="text-tertiary">
                    {' · '}
                    {row.conversation.title || t('Untitled task')}
                  </span>
                )}
              </button>
            ))}
          </section>
        )
      })}
    </div>
  )
}

/** Who asked a question and when: its face or Runtime icon, its name, which opens it, and the time. */
export function QuestionSource({
  conversation,
  askedAt,
  onOpen,
}: {
  conversation: Source
  askedAt: string
  onOpen: () => void
}) {
  return (
    <header className="flex min-w-0 items-center gap-1.5 text-[12px] leading-4 text-tertiary">
      <QuestionSourceIcon conversation={conversation} size={14} />
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 items-center gap-1 font-medium text-main hover:underline"
      >
        <span className="truncate">{conversation.title || t('Untitled task')}</span>
        <ArrowUpRight aria-hidden className="size-3 shrink-0" />
      </button>
      <span aria-hidden>·</span>
      <time dateTime={askedAt} className="shrink-0">
        {chatTime(askedAt)}
      </time>
    </header>
  )
}

/** A Bot's face, or a Task's Runtime icon. */
function QuestionSourceIcon({ conversation, size = 16 }: { conversation: Source; size?: number }) {
  return (
    <AgentAvatar
      agentId={conversation.sessionId}
      avatar={conversation.avatar}
      provider={conversation.agentRuntime}
      size={size}
      showBadge={false}
    />
  )
}
