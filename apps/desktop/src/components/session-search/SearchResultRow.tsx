import clsx from 'clsx'
import { CornerDownLeft, MessageSquare } from 'lucide-react'

import { linkClickMode } from '../../lib/linkClickMode'
import { isMac } from '../../lib/platform'
import { searchMatch } from '../../lib/searchMatch'

import type { ReactNode } from 'react'

export function Highlight({ text, query }: { text: string; query: string }) {
  const match = searchMatch(text, query)

  if (!match) return <>{text}</>

  return (
    <>
      {text.slice(0, match.start)}
      <mark className="rounded-sm bg-zViolet-500/25 text-main">
        {text.slice(match.start, match.end)}
      </mark>
      {text.slice(match.end)}
    </>
  )
}

export function SearchResultRow({
  id,
  title,
  subtitle,
  preview,
  query,
  selected,
  avatar,
  onSelect,
  onOpen,
}: {
  id: string
  title: string
  subtitle: string
  preview?: string
  query: string
  selected: boolean
  avatar?: ReactNode
  onSelect: () => void
  onOpen: (beside: boolean) => void
}) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      onMouseMove={onSelect}
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => {
        const mode = linkClickMode(event, isMac)

        if (mode) onOpen(mode === 'beside')
      }}
      className={clsx(
        'flex min-h-[52px] cursor-pointer items-center gap-2.5 rounded-md px-2 py-2',
        selected ? 'bg-zGray-750' : 'hover:bg-zGray-800',
      )}
    >
      {avatar ?? <MessageSquare size={16} className="shrink-0 text-secondary" />}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-main">
          <Highlight text={title} query={query} />
        </div>
        {preview && (
          <div className="mt-0.5 truncate text-xs text-secondary">
            <Highlight text={preview} query={query} />
          </div>
        )}
        <div className="mt-0.5 truncate text-xs text-secondary">{subtitle}</div>
      </div>
      {selected && (
        <span className="flex shrink-0 items-center gap-2 text-xs text-secondary">
          <span className="hidden sm:inline">{avatar ? 'View agents' : 'Open'}</span>
          <CornerDownLeft size={15} />
        </span>
      )}
    </div>
  )
}
