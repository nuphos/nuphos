import clsx from 'clsx'

import { t } from '../../i18n'

import type { InboxQuestion } from './inboxItems'
import type { KeyboardEvent } from 'react'

/** The Inbox's list: one row per open question, with the conversation that asked it. */
export function QuestionRail({
  rows,
  openId,
  keyboardNavigation,
  onSelect,
}: {
  rows: readonly InboxQuestion[]
  openId: string | undefined
  /** ↑ and ↓ open the row above or below. */
  keyboardNavigation: boolean
  onSelect: (row: InboxQuestion) => void
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!keyboardNavigation || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return
    const at =
      rows.findIndex((row) => row.request.id === openId) + (event.key === 'ArrowDown' ? 1 : -1)
    const next = at >= 0 ? rows.at(at) : undefined

    if (!next) return
    event.preventDefault()
    onSelect(next)
    event.currentTarget
      .querySelector<HTMLElement>(`[data-inbox-question="${CSS.escape(next.request.id)}"]`)
      ?.focus()
  }

  return (
    <div
      onKeyDown={onKeyDown}
      className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto scrollbar-thin px-2 pt-2"
    >
      {rows.map((row) => {
        const selected = row.request.id === openId

        return (
          <button
            key={`${row.conversation.sessionId}:${row.request.id}`}
            type="button"
            aria-current={selected ? 'true' : undefined}
            data-inbox-question={row.request.id}
            onClick={() => onSelect(row)}
            className={clsx(
              'flex flex-col gap-0.5 rounded-md px-2.5 py-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-line-focus',
              selected ? 'bg-state-selected' : 'hover:bg-state-hover',
            )}
          >
            <span className="line-clamp-2 break-words text-[13px] leading-5 text-main">
              {row.request.question}
            </span>
            <span className="truncate text-[12px] text-tertiary">
              {t('From {name}', { name: row.conversation.title || t('Untitled task') })}
            </span>
          </button>
        )
      })}
    </div>
  )
}
