import { Popover } from '@base-ui/react/popover'
import clsx from 'clsx'
import { ChevronDown, Clock } from 'lucide-react'
import { useState } from 'react'

import { useResetOnKey } from '../useResetOnKey'

import { QUICK_RANGES, timeSelLabel, toLocalInput } from './time'

import type { TimeSel } from './time'

// Grafana-style time range picker: quick relative ranges plus an absolute
// from/to form.
export function TimeRangePicker({
  sel,
  range,
  onChange,
}: {
  sel: TimeSel
  range: { from: number; to: number }
  onChange: (next: TimeSel) => void
}) {
  const [open, setOpen] = useState(false)
  const [fromInput, setFromInput] = useState('')
  const [toInput, setToInput] = useState('')

  // Seed the absolute inputs from the currently resolved range each time the
  // menu opens.
  useResetOnKey(String(open), () => {
    if (!open) return
    setFromInput(toLocalInput(range.from))
    setToInput(toLocalInput(range.to))
  })

  const absFrom = fromInput ? new Date(fromInput).getTime() : NaN
  const absTo = toInput ? new Date(toInput).getTime() : NaN
  const absValid = Number.isFinite(absFrom) && Number.isFinite(absTo) && absFrom < absTo

  return (
    <Popover.Root open={open} onOpenChange={setOpen} modal>
      <Popover.Trigger className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zGray-900 border border-zGray-800 hover:bg-zGray-800 text-[11.5px]">
        <Clock className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />
        <span className="text-main">{timeSelLabel(sel)}</span>
        <ChevronDown className="w-3 h-3 text-tertiary" strokeWidth={1.8} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={6} className="z-[1000]">
          <Popover.Popup
            className={(state) =>
              clsx(
                't-dropdown flex overflow-hidden rounded-lg border border-zGray-800/60 bg-main shadow-[0_4px_6px_-5px_rgba(0,0,0,0.2)] outline-none',
                state.open && 'is-open',
                state.transitionStatus === 'ending' && 'is-closing',
              )
            }
            style={{ transformOrigin: 'top right' }}
          >
            <div className="w-[230px] px-3 py-2.5 border-r border-zGray-800/60">
              <div className="text-[11px] font-medium text-secondary mb-2">Absolute time range</div>
              <label className="block text-[10.5px] text-tertiary mb-1">From</label>
              <input
                type="datetime-local"
                value={fromInput}
                onChange={(e) => setFromInput(e.target.value)}
                className="w-full mb-2 px-2 py-1 rounded bg-field border border-zGray-800 text-[11.5px] text-main outline-none focus:border-zViolet-accent/60"
              />
              <label className="block text-[10.5px] text-tertiary mb-1">To</label>
              <input
                type="datetime-local"
                value={toInput}
                onChange={(e) => setToInput(e.target.value)}
                className="w-full mb-2.5 px-2 py-1 rounded bg-field border border-zGray-800 text-[11.5px] text-main outline-none focus:border-zViolet-accent/60"
              />
              <button
                disabled={!absValid}
                onClick={() => {
                  onChange({ kind: 'absolute', from: absFrom, to: absTo })
                  setOpen(false)
                }}
                className="px-2.5 py-1 rounded bg-zBlue-500 hover:bg-zBlue-400 disabled:opacity-40 disabled:pointer-events-none text-white text-[11.5px]"
              >
                Apply time range
              </button>
            </div>
            <div className="w-[170px] max-h-80 overflow-auto scrollbar-thin py-1">
              {QUICK_RANGES.map((r) => {
                const active = sel.kind === 'relative' && sel.from === r.from

                return (
                  <button
                    key={r.from}
                    onClick={() => {
                      onChange({ kind: 'relative', from: r.from })
                      setOpen(false)
                    }}
                    className={`w-full text-left px-3 py-1.5 text-[12px] hover:bg-zGray-800 ${
                      active ? 'text-zViolet-accent' : 'text-secondary'
                    }`}
                  >
                    {r.label}
                  </button>
                )
              })}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
