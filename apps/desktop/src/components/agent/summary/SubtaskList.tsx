import { useId, useState } from 'react'

import { t } from '../../../i18n'

import { ThreadRow, focusRingClass } from './ChatSummaryRows'

import type { SubAgent } from './chatSummaryModel'

/** Rows shown before the list is expanded, about the old 20rem cap; the panel scrolls the rest. */
export const SUBTASK_PREVIEW_COUNT = 10

/** Filters stay outside the list. Expansion belongs to the list, not the section fold. */
export function SubtaskList({
  subAgents,
  onOpen,
}: {
  subAgents: SubAgent[]
  onOpen: (id: string) => void
}) {
  const id = useId()
  const [expanded, setExpanded] = useState(false)
  const hidden = subAgents.length - SUBTASK_PREVIEW_COUNT
  const shown = expanded || hidden <= 0 ? subAgents : subAgents.slice(0, SUBTASK_PREVIEW_COUNT)
  let label = t('Show less')

  if (!expanded) label = hidden === 1 ? t('Show 1 more') : t('Show {count} more', { count: hidden })

  return (
    <>
      <div id={id} className="flex flex-col gap-0.5">
        {shown.map(({ conversation, state }) => (
          <ThreadRow
            key={conversation.sessionId}
            conversation={conversation}
            state={state}
            onOpen={onOpen}
          />
        ))}
      </div>
      {hidden > 0 && (
        <button
          type="button"
          aria-controls={id}
          aria-expanded={expanded}
          // The rows' inset, so the text starts under their icons.
          className={`-mx-1.5 mt-1 self-start rounded-md px-1.5 py-1 text-xs text-secondary hover:bg-state-hover ${focusRingClass}`}
          onClick={() => setExpanded(!expanded)}
        >
          {label}
        </button>
      )}
    </>
  )
}
