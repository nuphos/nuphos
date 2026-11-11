import clsx from 'clsx'
import { CornerDownLeft } from 'lucide-react'

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
      <mark className="rounded-sm bg-state-selected text-main">
        {text.slice(match.start, match.end)}
      </mark>
      {text.slice(match.end)}
    </>
  )
}

export function SearchResultRow({
  id,
  title,
  meta,
  preview,
  query,
  selected,
  avatar,
  action,
  onSelect,
  onOpen,
}: {
  id: string
  title: string
  /** Quiet detail at the row's end, such as when it was opened; the selected row shows its action there instead. */
  meta: string
  preview?: string
  query: string
  selected: boolean
  avatar: ReactNode
  /** What Enter does, shown on the selected row. */
  action: string
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
        'flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5',
        selected ? 'bg-state-selected' : 'hover:bg-state-hover',
      )}
    >
      {avatar}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] text-main">
          <Highlight text={title} query={query} />
        </div>
        {preview && (
          <div className="mt-0.5 truncate text-xs text-secondary">
            <Highlight text={preview} query={query} />
          </div>
        )}
      </div>
      {selected ? (
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-secondary">
          {action}
          <CornerDownLeft size={14} />
        </span>
      ) : (
        <span className="shrink-0 truncate text-xs text-tertiary">{meta}</span>
      )}
    </div>
  )
}
