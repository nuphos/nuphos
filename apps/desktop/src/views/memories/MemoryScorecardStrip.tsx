import { Popover } from '@base-ui/react/popover'
import { Info } from 'lucide-react'
import { useState } from 'react'

import { deriveMemoryHealth } from './memoryHealth'

import type { AgentMemoryScorecard } from '../../api'

// Is memory helping? Three figures, folded behind an icon in the controls row
// — read occasionally, so they don't earn permanent space above the list.
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
  const notChecked = h.recall.total - h.checkedTurns

  // "checked", not "judged": the reader does not need to know an attribution
  // judge exists to understand that the rate covers a subset of turns.
  let appliedNote = 'no turns checked yet'

  if (h.applied) {
    appliedNote = `${String(h.applied.applied)} of ${String(h.applied.judged)} checked turns`
  }

  let appliedTitle = 'No turns have been checked yet, so there is nothing to compute a rate from.'

  if (h.applied) {
    appliedTitle = `Memory was verified as used in ${String(h.applied.applied)} of the ${String(h.applied.judged)} turns we checked.`
    if (notChecked > 0) {
      appliedTitle += ` The other ${String(notChecked)} turns in the window weren't checked — often because nothing was recalled for them — so they are left out rather than counted as failures.`
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        title="Memory stats"
        aria-label="Memory stats"
        className="h-7 px-2 rounded-md inline-flex items-center text-tertiary transition-colors hover:text-secondary hover:bg-zGray-800/50"
      >
        <Info className="h-3.5 w-3.5" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={6} className="z-[1000]">
          <Popover.Popup className="w-[268px] rounded-lg border border-zGray-800 bg-zGray-900 p-3.5 shadow-xl outline-none">
            <div className="flex flex-col gap-3">
              <Stat
                label="applied"
                value={h.applied ? `${String(h.applied.pct)}%` : '—'}
                note={appliedNote}
                window={`${String(h.windowDays)}d`}
                title={appliedTitle}
              />
              <Stat
                label="recall"
                value={`${String(h.recall.pct)}%`}
                note={`${String(h.recall.hit)} of ${String(h.recall.total)} turns`}
                window={`${String(h.windowDays)}d`}
                title="Turns where the agent was given at least one relevant memory."
              />
              <Stat
                label="learned"
                value={String(h.learned7d)}
                note="memories"
                window="7d"
                title="Memories auto-learned in the last 7 days. This is the one figure on a 7-day window — the rest cover 90."
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
  /** This figure's own window. Stated per row rather than once at the top:
   *  `learned` covers 7 days while everything else covers 90, and a card-level
   *  header would have to lie about one of them. */
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
