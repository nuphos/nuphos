import { clsx } from 'clsx'
import { useEffect, useRef } from 'react'

import { t } from '../../../i18n'
import {
  setChangesFilter,
  takeChangesReveal,
  useChangesFilter,
  useChangesRevealRequest,
} from '../../../lib/chatSummaryPanel'

import { changesFilterOptions, filterChanges, shownChangesFilter } from './chatSummaryModel'
import { ChangeRow, focusRingClass, SummarySection } from './ChatSummaryRows'

import type { ChangesFilterOption } from './chatSummaryModel'
import type { SessionResource } from '../../../api/session-resource-types'
import type { KeyboardEvent } from 'react'

const STEP: Partial<Record<string, number>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
}

/** One radio per status; the arrows move the choice, as in any radio group. */
function ChangesFilterPills({
  options,
  selected,
}: {
  options: ChangesFilterOption[]
  selected: ChangesFilterOption['filter']
}) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = options.findIndex((option) => option.filter === selected)
    const step = STEP[event.key]
    let next: number | undefined

    if (step !== undefined) next = (index + step + options.length) % options.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = options.length - 1
    if (next === undefined) return
    event.preventDefault()
    const option = options[next]

    setChangesFilter(option.filter)
    event.currentTarget.querySelector<HTMLElement>(`[data-filter="${option.filter}"]`)?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label={t('Filter changes by status')}
      onKeyDown={onKeyDown}
      className="-mx-1 flex flex-wrap gap-0.5 pt-1.5"
    >
      {options.map((option) => {
        const checked = option.filter === selected

        return (
          <button
            key={option.filter}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={`${option.label}, ${String(option.count)}`}
            data-filter={option.filter}
            tabIndex={checked ? 0 : -1}
            onClick={() => setChangesFilter(option.filter)}
            className={clsx(
              'flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[12px] transition-colors motion-reduce:transition-none',
              checked
                ? 'bg-zGray-800 text-main'
                : 'text-tertiary hover:bg-zGray-800/50 hover:text-main',
              focusRingClass,
            )}
          >
            <span>{option.label}</span>
            <span aria-hidden className="tabular-nums text-tertiary">
              {option.count}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * Pull requests and issues with a status filter. The filter is shared by the
 * window; one that matches nothing in this chat shows All without being reset.
 * When the merged badge opens the panel for this chat, the list scrolls into
 * view and the chosen filter, or the first change, takes focus.
 */
export function ChangesSection({
  sessionId,
  changes,
  onOpen,
}: {
  sessionId: string
  changes: SessionResource[]
  onOpen: (url: string, external: boolean) => void
}) {
  const sectionRef = useRef<HTMLElement>(null)
  const stored = useChangesFilter()
  const revealRequest = useChangesRevealRequest()
  const options = changesFilterOptions(changes)
  const filter = shownChangesFilter(stored, options)

  useEffect(() => {
    const section = sectionRef.current

    if (!section || !takeChangesReveal(sessionId)) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const target =
      section.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]') ??
      section.querySelector<HTMLElement>('button')

    section.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' })
    target?.focus({ preventScroll: true })
  }, [revealRequest, sessionId])

  return (
    <SummarySection
      ref={sectionRef}
      title={t('Changes')}
      header={options.length > 0 && <ChangesFilterPills options={options} selected={filter} />}
    >
      {filterChanges(changes, filter).map((resource) => (
        <ChangeRow key={resource.id} resource={resource} onOpen={onOpen} />
      ))}
    </SummarySection>
  )
}
