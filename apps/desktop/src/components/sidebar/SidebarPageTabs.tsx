import clsx from 'clsx'
import { Inbox, MessagesSquare } from 'lucide-react'

import { t } from '../../i18n'
import { CountBadge } from '../ui/count-badge'
import { Tooltip } from '../ui/tooltip'

import { BotsModeIcon } from './BotsModeIcon'

import { SIDEBAR_PAGES } from './swipe-gesture'

import type { SidebarPage } from './swipe-gesture'

/** Semantic mode switches, each with a visible count: unread Bots and Tasks, open questions on the Inbox. */
export function SidebarPageTabs({
  page,
  onPage,
  counts,
}: {
  page: SidebarPage
  onPage: (page: SidebarPage) => void
  /** Bots, Tasks and Inbox, in page order. */
  counts: readonly [number, number, number]
}) {
  const labels = [t('Bots'), t('Tasks'), t('Inbox')]

  return (
    <div
      className="sidebar-page-indicators flex shrink-0 justify-center titlebar-no-drag"
      role="tablist"
      aria-label={labels.join(' / ')}
    >
      {SIDEBAR_PAGES.map((id, index) => {
        const label = labels[index]
        const shownCount = counts[index]
        const accessibleLabel = shownCount > 0 ? `${label} · ${String(shownCount)}` : label

        return (
          <Tooltip
            key={id}
            content={accessibleLabel}
            trigger={
              <button
                id={`sidebar-${id}-tab`}
                aria-controls={`sidebar-${id}-page`}
                role="tab"
                aria-label={accessibleLabel}
                aria-selected={page === index}
                tabIndex={page === index ? 0 : -1}
                onClick={() => onPage(index as SidebarPage)}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
                  event.preventDefault()
                  const next = Math.max(
                    0,
                    Math.min(
                      SIDEBAR_PAGES.length - 1,
                      index + (event.key === 'ArrowRight' ? 1 : -1),
                    ),
                  ) as SidebarPage

                  onPage(next)
                  document.getElementById(`sidebar-${SIDEBAR_PAGES[next]}-tab`)?.focus()
                }}
                className={clsx('sidebar-page-indicator', page === index && 'is-active')}
              />
            }
          >
            {id === 'bots' && <BotsModeIcon />}
            {id === 'tasks' && <MessagesSquare aria-hidden strokeWidth={1.8} className="size-4" />}
            {id === 'inbox' && <Inbox aria-hidden strokeWidth={1.8} className="size-4" />}
            {shownCount > 0 && (
              <CountBadge count={shownCount} size="sm" className="absolute -right-1 -top-1" />
            )}
          </Tooltip>
        )
      })}
    </div>
  )
}
