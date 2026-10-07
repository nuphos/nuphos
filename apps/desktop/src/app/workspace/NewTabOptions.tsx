import { clsx } from 'clsx'
import { ChevronRight, History, Star } from 'lucide-react'

import { newTabOptionDomId } from '../../lib/launcherMatch'

import type { Item } from '../../components/sidebar/types'
import type { NewTabOption } from '../../lib/launcherMatch'
import type { ReactNode } from 'react'

export function LauncherIcon({ item }: { item: Item }) {
  const Icon = item.icon

  return (
    <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-zGray-800/45 text-secondary ring-1 ring-inset ring-zGray-700/20 transition-colors group-data-[active]:bg-zGray-800/75 group-data-[active]:text-main">
      {item.iconNode ?? (Icon ? <Icon className="h-[15px] w-[15px]" strokeWidth={1.7} /> : null)}
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
        'group flex min-w-0 items-center rounded-lg transition-colors',
        active && 'bg-zGray-800/45',
      )}
    >
      <button
        type="button"
        tabIndex={-1}
        onClick={(event) => option.open(event.metaKey || event.ctrlKey)}
        className="flex min-w-0 flex-1 items-center gap-3 px-2.5 py-2 text-left outline-none"
      >
        {option.icon}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-main">{option.label}</span>
          {option.detail && (
            <span className="block truncate text-[11px] text-tertiary">{option.detail}</span>
          )}
        </span>
        <ChevronRight
          className={clsx(
            'h-3.5 w-3.5 flex-shrink-0 text-tertiary transition-all',
            active ? 'translate-x-0 opacity-100' : 'translate-x-[-2px] opacity-0',
          )}
        />
      </button>
      {onRemoveFavorite && item && (
        <button
          type="button"
          tabIndex={-1}
          onClick={() => onRemoveFavorite(item)}
          className="mr-1.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-warning/80 opacity-0 transition-all hover:bg-zGray-700/45 hover:text-warning group-hover:opacity-100"
          title={`Remove ${option.label} from Favorites`}
          aria-label={`Remove ${option.label} from Favorites`}
        >
          <Star className="h-3.5 w-3.5" fill="currentColor" strokeWidth={1.7} />
        </button>
      )}
    </div>
  )
}

export function HistoryIcon() {
  return (
    <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-tertiary">
      <History className="h-4 w-4" />
    </span>
  )
}

export function NewTabGroupSection({
  title,
  favorites,
  children,
}: {
  title: string
  favorites?: boolean
  children: ReactNode
}) {
  return (
    <section className={favorites ? 'mb-10' : 'mb-8'}>
      <div className="mb-2 flex items-center gap-2 px-1">
        {favorites && (
          <Star className="h-3 w-3 text-warning/80" fill="currentColor" strokeWidth={1.7} />
        )}
        <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-tertiary">
          {title}
        </h2>
      </div>
      <div
        className={clsx(
          'grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-x-3 gap-y-0.5',
          favorites &&
            'rounded-xl border border-zGray-800/55 bg-elevated/20 p-1.5 shadow-[0_4px_18px_-14px_rgba(0,0,0,0.45)]',
        )}
      >
        {children}
      </div>
    </section>
  )
}
