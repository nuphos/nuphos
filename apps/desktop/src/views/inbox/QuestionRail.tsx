import clsx from 'clsx'
import { ArrowUpRight } from 'lucide-react'

import { AgentAvatar } from '../../components/agent/AgentAvatar'
import { chatTime } from '../../components/sidebar/chat-preview'
import { t } from '../../i18n'

import { inboxGroups, inboxSource } from './inboxItems'
import { returnTime } from './snooze'

import type { InboxQuestion } from './inboxItems'
import type { AgentConversation } from '../../api/agent-types'
import type { ReactNode } from 'react'

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
          <Entering key={conversation.sessionId} as="section">
            <div className="flex flex-col gap-px">
              <h3 className="flex h-7 items-center gap-2 px-2 text-[12.5px] font-medium text-main">
                <QuestionSourceIcon conversation={conversation} />
                <span className="truncate">{conversation.title || t('Untitled task')}</span>
              </h3>
              {group.map((row) => (
                <Entering key={row.request.id}>
                  <button
                    type="button"
                    aria-current={row.request.id === openId ? 'true' : undefined}
                    data-inbox-question={row.request.id}
                    onClick={() => onSelect(row)}
                    className={clsx(
                      'h-7 w-full truncate rounded-md pl-8 pr-2 text-left text-[13px] outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-line-focus',
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
                </Entering>
              ))}
            </div>
          </Entering>
        )
      })}
    </div>
  )
}

/**
 * The questions snoozed out of the Inbox, below its list: each with when it
 * comes back, and Unsnooze to bring it back now.
 */
export function SnoozedRail({
  rows,
  onUnsnooze,
}: {
  rows: readonly InboxQuestion[]
  onUnsnooze: (row: InboxQuestion) => void
}) {
  if (!rows.length) return null

  return (
    <section className="mt-3 flex flex-col gap-px">
      <h3 className="flex h-7 items-center px-2 text-[12.5px] font-medium text-tertiary">
        {t('Snoozed')}
      </h3>
      {rows.map((row) => (
        <div
          key={row.request.id}
          data-snoozed-question={row.request.id}
          className="group flex h-7 items-center gap-2 rounded-md pl-2 pr-1 text-[13px] text-tertiary hover:bg-state-hover"
        >
          <span className="min-w-0 flex-1 truncate">{row.request.question}</span>
          {/* When it comes back, until hovered or focused: then Unsnooze, in the same place. */}
          <span className="grid shrink-0 justify-items-end text-[11.5px]">
            <time
              dateTime={row.request.snoozedUntil}
              className="pointer-events-none col-start-1 row-start-1 group-focus-within:opacity-0 group-hover:opacity-0"
            >
              {returnTime(row.request.snoozedUntil ?? '')}
            </time>
            <button
              type="button"
              onClick={() => onUnsnooze(row)}
              className="col-start-1 row-start-1 text-secondary opacity-0 outline-none hover:text-main focus-visible:opacity-100 group-hover:opacity-100"
            >
              {t('Unsnooze')}
            </button>
          </span>
        </div>
      ))}
    </section>
  )
}

/** A group or row of the list, entering with the sidebar's rows: it opens to its height and rises in. */
function Entering({ as: Tag = 'div', children }: { as?: 'div' | 'section'; children: ReactNode }) {
  return (
    <Tag className="t-collapse t-sidebar-session t-stagger is-shown" data-open="true">
      <div className="t-collapse-inner t-stagger-line">{children}</div>
    </Tag>
  )
}

/**
 * Who asked a question and when: its face or Runtime icon, its name, which opens it, and the time.
 * A question the agent rewrote since says when, so an old card's new premise is not a surprise.
 */
export function QuestionSource({
  conversation,
  askedAt,
  updatedAt,
  onOpen,
}: {
  conversation: Source
  askedAt: string
  updatedAt?: string
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
      {updatedAt && (
        <>
          <span aria-hidden>·</span>
          <time dateTime={updatedAt} className="shrink-0">
            {t('Edited {time}', { time: chatTime(updatedAt) ?? '' })}
          </time>
        </>
      )}
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
