import { clsx } from 'clsx'

import { focusRingClass } from './ChatSummaryRows'

import type { KeyboardEvent } from 'react'

export type FilterOption<F extends string> = { filter: F; label: string; count: number }

const STEP: Partial<Record<string, number>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
}

/** One radio per status with its count; the arrows move the choice, as in any radio group. */
export function FilterPills<F extends string>({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string
  options: readonly FilterOption<F>[]
  selected: F
  onSelect: (filter: F) => void
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

    onSelect(option.filter)
    event.currentTarget.querySelector<HTMLElement>(`[data-filter="${option.filter}"]`)?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
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
            onClick={() => onSelect(option.filter)}
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
