import { clsx } from 'clsx'
import { ChevronDown, ChevronRight, History, Star } from 'lucide-react'

import { t } from '../../i18n'
import { newTabOptionDomId } from '../../lib/launcherMatch'

import type { Item } from '../../components/sidebar/types'
import type { NewTabOption } from '../../lib/launcherMatch'
import type { ReactNode } from 'react'

export function LauncherIcon({ item }: { item: Item }) {
  const Icon = item.icon

  return (
    <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-secondary transition-colors group-data-[active]:text-main">
      {item.iconNode ?? (Icon ? <Icon className="h-3.5 w-3.5" strokeWidth={1.7} /> : null)}
    </span>
  )
}

export function NewTabOptionRow({
  option,
  index,
  active,
  onHover,
  onRemoveFavorite,
}: {
  option: NewTabOption
  index: number
  active: boolean
  onHover: (index: number) => void
  onRemoveFavorite?: (item: Item) => void
}) {
  const { item } = option

  return (
    <div
      id={newTabOptionDomId(index)}
      role="option"
      aria-selected={active}
      data-active={active ? '' : undefined}
      onMouseMove={() => onHover(index)}
      className={clsx(
        'group flex min-w-0 items-center rounded-md transition-colors',
        active && 'bg-state-selected',
      )}
    >
      <button
        type="button"
        tabIndex={-1}
        onClick={(event) => option.open(event.metaKey || event.ctrlKey)}
        className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left outline-none"
      >
        {option.icon}
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-main">{option.label}</span>
        {option.detail && (
          <span className="max-w-[45%] flex-shrink-0 truncate text-[11px] text-tertiary">
            {option.detail}
          </span>
        )}
      </button>
      {onRemoveFavorite && item && (
        <button
          type="button"
          tabIndex={-1}
          onClick={() => onRemoveFavorite(item)}
          className="mr-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-warning/80 opacity-0 transition-all hover:bg-state-hover hover:text-warning group-hover:opacity-100"
          title={t('Remove {title} from Favorites', { title: option.label })}
          aria-label={t('Remove {title} from Favorites', { title: option.label })}
        >
          <Star className="h-3 w-3" fill="currentColor" strokeWidth={1.7} />
        </button>
      )}
    </div>
  )
}

export function HistoryIcon() {
  return (
    <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center text-tertiary">
      <History className="h-3.5 w-3.5" />
    </span>
  )
}

export function NewTabGroupSection({
  title,
  favorites,
  count,
  collapsed,
  onToggle,
  children,
}: {
  title: string
  favorites?: boolean
  count: number
  collapsed: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <section className={collapsed ? 'mb-1.5' : 'mb-4'}>
      <h2 className="mb-1">
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={onToggle}
          className="flex w-full items-center gap-1.5 rounded-md px-2 py-0.5 text-left text-[10px] font-medium uppercase tracking-[0.08em] text-tertiary outline-none transition-colors hover:text-secondary focus-visible:text-secondary focus-visible:ring-1 focus-visible:ring-line-control"
        >
          {favorites && (
            <Star className="h-2.5 w-2.5 text-warning/80" fill="currentColor" strokeWidth={1.7} />
          )}
          <span>{title}</span>
          {collapsed && <span className="tabular-nums">{count}</span>}
          <span className="t-icon-swap h-3 w-3 shrink-0" data-state={collapsed ? 'a' : 'b'}>
            <ChevronRight className="t-icon h-3 w-3" data-icon="a" />
            <ChevronDown className="t-icon h-3 w-3" data-icon="b" />
          </span>
        </button>
      </h2>
      {!collapsed && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-x-1">
          {children}
        </div>
      )}
    </section>
  )
}
