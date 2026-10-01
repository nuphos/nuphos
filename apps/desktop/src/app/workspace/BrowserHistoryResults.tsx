import { ChevronRight, History } from 'lucide-react'

import type { BrowserHistoryEntry } from '../../lib/browserHistory'
import type { RefObject } from 'react'

export function BrowserHistoryResults({
  entries,
  firstResultRef,
  onOpen,
}: {
  entries: BrowserHistoryEntry[]
  firstResultRef: RefObject<HTMLButtonElement | null>
  onOpen: (url: string, title: string, newTab: boolean) => void
}) {
  if (entries.length === 0) return null

  return (
    <section className="mb-8" aria-label="Browsing history">
      <h2 className="mb-2 px-1 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-tertiary">
        Browsing history
      </h2>
      <div className="space-y-0.5">
        {entries.map((entry, index) => (
          <button
            key={entry.url}
            ref={index === 0 ? firstResultRef : undefined}
            type="button"
            onClick={(event) => onOpen(entry.url, entry.title, event.metaKey || event.ctrlKey)}
            className="group flex w-full min-w-0 items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-zGray-800/45 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zViolet-500/60"
          >
            <History className="h-4 w-4 shrink-0 text-tertiary" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-main">
                {entry.title}
              </span>
              <span className="block truncate text-[11px] text-tertiary">{entry.url}</span>
            </span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-tertiary" />
          </button>
        ))}
      </div>
    </section>
  )
}
