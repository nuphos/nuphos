import { Popover } from '@base-ui/react/popover'
import clsx from 'clsx'
import { ArrowUpRight, Webhook, X } from 'lucide-react'
import { useMemo } from 'react'

import { Button } from '../../../components/ui/button'
import { scheduleSummary } from '../cron'
import { formatUtcAndLocal, viewerTimeZone } from '../cronTime'

import { eventDotClasses } from './model'
import { nextOccurrencesAfter } from './occurrences'

import type { ScheduleEvent } from './model'
import type { AgentTrigger } from '../../../api'

const EVENT_DAY = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
})
const UPCOMING = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
})

export type SelectedEvent = {
  event: ScheduleEvent
  /** The clicked chip — the popover anchors to it. */
  anchor: HTMLElement
}

type Props = {
  selected: SelectedEvent
  /** Undefined when the trigger vanished under the selection (deleted, team
   *  switch); the popup then shows only what the occurrence itself knows. */
  trigger: AgentTrigger | undefined
  onClose: () => void
  onOpenTrigger?: (triggerId: string, triggerName: string) => void
}

/**
 * Occurrence detail popup, anchored to the clicked chip: when it fires, what
 * the schedule is, what the agent will be asked to do — and the jump to the
 * trigger itself for editing. Styling mirrors MenuContent so every floating
 * surface in the app shares one look.
 */
export function EventPopover({ selected, trigger, onClose, onOpenTrigger }: Props) {
  const { event } = selected
  const timeZone = viewerTimeZone()
  const expression = trigger?.cronExpression?.trim()
  const upcoming = useMemo(
    () => (expression ? nextOccurrencesAfter(expression, event.start, 3) : []),
    [expression, event.start],
  )

  return (
    <Popover.Root open onOpenChange={(open) => !open && onClose()}>
      <Popover.Portal>
        <Popover.Positioner
          anchor={selected.anchor}
          side="right"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="z-[1000]"
        >
          <Popover.Popup
            className={(state) =>
              clsx(
                't-dropdown w-72 rounded-lg border border-zGray-800/60 bg-main shadow-[0_10px_28px_-6px_rgba(0,0,0,0.6)] outline-none',
                state.open && 'is-open',
                state.transitionStatus === 'ending' && 'is-closing',
              )
            }
          >
            <div className="flex items-start justify-between gap-2 px-3.5 pt-3">
              <div className="min-w-0">
                <div className="flex items-stretch gap-2">
                  {/* The swatch grows with the title: it stretches to the row's
                      height and is inset 3px top and bottom, so one 18px line
                      leaves a 12px square (matching w-3), two lines a two-line
                      bar, and so on. */}
                  <span
                    className={`my-[3px] w-3 shrink-0 rounded-[3px] ${eventDotClasses(event.triggerId, event.enabled)}`}
                  />
                  <span className="min-w-0 break-words text-[13.5px] font-semibold leading-[18px] text-main">
                    {event.kind === 'webhook' && (
                      <Webhook className="mr-1 inline h-3.5 w-3.5 align-[-2px] text-secondary" />
                    )}
                    {event.name}
                    {trigger && !trigger.enabled && (
                      <span className="ml-1.5 inline-block translate-y-[-1px] rounded border border-main px-1 py-px align-middle text-[10px] font-medium text-tertiary">
                        Disabled
                      </span>
                    )}
                  </span>
                </div>
                {/* Indented past the swatch so it aligns with the title text. */}
                <div className="mt-0.5 pl-5 text-[12px] text-secondary">
                  {EVENT_DAY.format(event.start)} · {formatUtcAndLocal(event.start, timeZone)}
                </div>
              </div>
              <Button variant="ghost" size="icon-sm" aria-label="Close details" onClick={onClose}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>

            <div className="max-h-80 space-y-3.5 overflow-y-auto overflow-x-hidden px-3.5 py-3">
              {trigger && (
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-wide text-tertiary">
                    Schedule
                  </div>
                  <div className="mt-1 text-[12px] text-secondary">
                    {scheduleSummary(trigger, timeZone)}
                  </div>
                  {expression && (
                    <code className="mt-1 inline-block rounded bg-zGray-800/60 px-1.5 py-0.5 font-mono text-[11px] text-secondary">
                      {expression}
                    </code>
                  )}
                </div>
              )}

              {upcoming.length > 0 && (
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-wide text-tertiary">
                    Upcoming runs
                  </div>
                  <ul className="mt-1 space-y-0.5">
                    {upcoming.map((runAt) => (
                      <li key={runAt.getTime()} className="text-[12px] text-secondary">
                        {UPCOMING.format(runAt)} · {formatUtcAndLocal(runAt, timeZone)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {trigger?.messageTemplate && (
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-wide text-tertiary">
                    Agent prompt
                  </div>
                  {/* Shown in full — the popup body itself scrolls. break-words
                      because with overflow-y set on that body, the x axis
                      computes to auto too, and an unbreakable run (a URL, a
                      token) would otherwise widen it into a horizontal bar. */}
                  <div className="mt-1 whitespace-pre-wrap break-words text-[12px] leading-relaxed text-secondary">
                    {trigger.messageTemplate}
                  </div>
                </div>
              )}
            </div>

            {onOpenTrigger && (
              <div className="border-t border-main p-2.5">
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full"
                  onClick={() => onOpenTrigger(event.triggerId, event.name)}
                >
                  Open trigger
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
