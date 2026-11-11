import { Popover } from '@base-ui/react/popover'
import { Info } from 'lucide-react'
import { useState } from 'react'

import { t } from '../../i18n'

import { deriveMemoryHealth } from './memoryHealth'

import type { AgentMemoryScorecard } from '../../api'

// Is memory helping? Folded behind an icon in the controls row — read
// occasionally, so it doesn't earn permanent space above the list.
//
// Scope is deliberate: only what a team member can read and act on. Pipeline
// telemetry (judge coverage, distillation and judge error counts) used to sit
// under a divider here, but this page has no admin gate, and "distill failed
// 90 / 313" gives a reader alarm without recourse — it is our problem, not
// theirs. That data has an operator home already: the daily memory-health
// check in nuphos-agent-quality-loop.
//
// Deliberately stateless — no severity colour, no warning icon, no thresholds.
// Every figure carries the counts it came from, which is how sample size gets
// communicated without a badge deciding for the reader. See memoryHealth.ts
// for why applied% divides by checked turns.
export function MemoryScorecardStrip({ summary }: { summary: AgentMemoryScorecard['summary'] }) {
  const [open, setOpen] = useState(false)
  const h = deriveMemoryHealth(summary)

  // "checked", not "judged": the reader does not need to know an attribution
  // judge exists to understand that the rate covers a subset of turns.
  let appliedNote = t('no turns checked yet')

  if (h.applied) {
    appliedNote = t('{applied} of {judged} checked turns', {
      applied: String(h.applied.applied),
      judged: String(h.applied.judged),
    })
  }

  let appliedTitle = t(
    'No turns have been checked yet, so there is nothing to compute a rate from.',
  )

  if (h.applied) {
    appliedTitle = t('Memory was verified as used in {applied} of the {judged} turns we checked.', {
      applied: String(h.applied.applied),
      judged: String(h.applied.judged),
    })
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        title={t('Memory stats')}
        aria-label={t('Memory stats')}
        className="h-7 px-2 rounded-md inline-flex items-center text-tertiary transition-colors hover:text-secondary hover:bg-state-hover"
      >
        <Info className="h-3.5 w-3.5" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={6} className="z-[1000]">
          <Popover.Popup className="w-[268px] rounded-lg border border-line-control bg-surface-sheet p-3.5 shadow-xl outline-none">
            <div className="flex flex-col gap-3">
              <Stat
                label={t('applied')}
                value={h.applied ? `${String(h.applied.pct)}%` : '—'}
                note={appliedNote}
                window={`${String(h.windowDays)}d`}
                title={appliedTitle}
              />
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

// Value layer: the number leads, its denominator sits under it in the same
// column so the eye reads figure-then-basis without crossing the card.
function Stat({
  label,
  value,
  note,
  window,
  title,
}: {
  label: string
  value: string
  note: string
  /** The window this figure covers. */
  window: string
  title: string
}) {
  return (
    <div title={title}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10.5px] uppercase tracking-wide text-quaternary">{label}</span>
        <span className="text-[10px] text-quaternary tabular-nums">{window}</span>
      </div>
      <div className="mt-0.5 flex items-baseline gap-2">
        <span className="text-[17px] leading-none text-main font-medium tabular-nums">{value}</span>
        <span className="text-[11px] text-tertiary">{note}</span>
      </div>
    </div>
  )
}
