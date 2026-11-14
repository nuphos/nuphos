import clsx from 'clsx'

import { AgentAvatar } from '../../components/agent/AgentAvatar'
import { t } from '../../i18n'

import { inboxGroups } from './inboxItems'

import type { InboxQuestion } from './inboxItems'

/**
 * The Inbox's list in the sidebar: the open questions grouped by the Bot or
 * Task that asked, under its face or its Runtime's icon, one line each.
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
        const { conversation } = group[0]

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
              </button>
            ))}
          </section>
        )
      })}
    </div>
  )
}

/** A Bot's face, or a Task's Runtime icon. */
export function QuestionSourceIcon({
  conversation,
}: {
  conversation: InboxQuestion['conversation']
}) {
  return (
    <AgentAvatar
      agentId={conversation.sessionId}
      avatar={conversation.avatar}
      provider={conversation.agentRuntime}
      size={16}
      showBadge={false}
    />
  )
}
