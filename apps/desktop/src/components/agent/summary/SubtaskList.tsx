import { useEffect, useId, useRef, useState } from 'react'

import { t } from '../../../i18n'

import { ThreadRow, focusRingClass } from './ChatSummaryRows'

import type { SubAgent } from './chatSummaryModel'

/** Filters stay outside this viewport. Expansion belongs to the list, not the section fold. */
export function SubtaskList({
  subAgents,
  onOpen,
}: {
  subAgents: SubAgent[]
  onOpen: (id: string) => void
}) {
  const id = useId()
  const content = useRef<HTMLDivElement>(null)
  const [long, setLong] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const node = content.current

    if (!node) return
    const measure = () => {
      const limit = 20 * Number.parseFloat(getComputedStyle(document.documentElement).fontSize)

      setLong(node.scrollHeight > limit + 1)
    }

    measure()
    const observer = new ResizeObserver(measure)

    observer.observe(node)

    return () => observer.disconnect()
  }, [])

  return (
    <>
      {/* Include the rows' horizontal hover overhang inside the scroll viewport. */}
      <div id={id} className={`-mx-1.5 px-1.5 ${expanded ? '' : 'max-h-80 overflow-y-auto'}`}>
        <div ref={content} className="flex flex-col gap-0.5">
          {subAgents.map(({ conversation, state }) => (
            <ThreadRow
              key={conversation.sessionId}
              conversation={conversation}
              state={state}
              onOpen={onOpen}
            />
          ))}
        </div>
      </div>
      {long && (
        <button
          type="button"
          aria-controls={id}
          aria-expanded={expanded}
          className={`mt-1 self-start rounded px-1 py-1 text-xs text-secondary hover:bg-state-hover ${focusRingClass}`}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? t('Show less') : t('Expand all')}
        </button>
      )}
    </>
  )
}
