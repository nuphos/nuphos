import clsx from 'clsx'
import { MessagesSquare } from 'lucide-react'

import { t } from '../../i18n'
import { CountBadge } from '../ui/count-badge'
import { Tooltip } from '../ui/tooltip'

import { BotsModeIcon } from './BotsModeIcon'

import type { SidebarPage } from './swipe-gesture'

/** Semantic mode switches, with a visible attention count on Tasks. */
export function SidebarPageTabs({
  page,
  onPage,
  count,
}: {
  page: SidebarPage
  onPage: (page: SidebarPage) => void
  count: number
}) {
  return (
    <div
      className="sidebar-page-indicators flex shrink-0 justify-center titlebar-no-drag"
      role="tablist"
      aria-label={`${t('Bots')} / ${t('Tasks')}`}
    >
      {(['bots', 'tasks'] as const).map((id, index) => {
        const label = [t('Bots'), t('Tasks')][index]
        const accessibleLabel = index === 1 && count > 0 ? `${label} · ${String(count)}` : label

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
                    Math.min(1, index + (event.key === 'ArrowRight' ? 1 : -1)),
                  ) as SidebarPage

                  onPage(next)
                  document.getElementById(`sidebar-${['bots', 'tasks'][next]}-tab`)?.focus()
                }}
                className={clsx('sidebar-page-indicator', page === index && 'is-active')}
              />
            }
          >
            {index === 0 ? (
              <BotsModeIcon />
            ) : (
              <MessagesSquare aria-hidden strokeWidth={1.8} className="size-4" />
            )}
            {index === 1 && count > 0 && (
              <CountBadge count={count} size="sm" className="absolute -right-1 -top-1" />
            )}
          </Tooltip>
        )
      })}
    </div>
  )
}
