import { clsx } from 'clsx'
import { History, Star } from 'lucide-react'

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
        active && 'bg-zGray-800/50',
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
          className="mr-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-warning/80 opacity-0 transition-all hover:bg-zGray-700/45 hover:text-warning group-hover:opacity-100"
          title={`Remove ${option.label} from Favorites`}
          aria-label={`Remove ${option.label} from Favorites`}
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
  children,
}: {
  title: string
  favorites?: boolean
  children: ReactNode
}) {
  return (
    <section className="mb-4">
      <div className="mb-1 flex items-center gap-1.5 px-2">
        {favorites && (
          <Star className="h-2.5 w-2.5 text-warning/80" fill="currentColor" strokeWidth={1.7} />
        )}
        <h2 className="text-[10px] font-medium uppercase tracking-[0.08em] text-tertiary">
          {title}
        </h2>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-x-1">{children}</div>
    </section>
  )
}
