import clsx from 'clsx'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { AppSelect } from '../../components/ui/select'

import { nextOccurrencesAfter } from './calendar/occurrences'
import {
  EVERY_N_HOURS_OPTIONS,
  WEEKDAYS,
  buildCron,
  pad2,
  parseCron,
  sameMode,
  scheduleSummary,
} from './cron'
import { formatUtcRun, viewerTimeZone } from './cronTime'

import type { CronMode } from './cron'

// ─────────────────────────── Cron builder ───────────────────────────
// Friendly schedule editor. Two preset modes cover the cases people actually
// ask for ("every N hours" + "at HH:MM on these weekdays") and a Custom mode
// preserves the raw escape hatch for power users. On edit, we try to round-trip
// the saved expression back into a preset; if we can't, it lands in Custom
// with the original string untouched, so we never silently mutate a schedule
// the user wrote by hand. Every field is UTC — the scheduler's clock — with the
// viewer's equivalent shown beside it rather than converted into it.
export function CronBuilder({
  value,
  onChange,
}: {
  value: string
  onChange: (expr: string) => void
}) {
  // Parse incoming value once and keep mode in local state so the user can
  // change individual fields without losing other selections. Re-deriving from
  // `value` on every render would cause flicker when a number input is in
  // intermediate state.
  const [mode, setMode] = useState<CronMode>(() => parseCron(value))
  // Track the value we last pushed to the parent so the resync effect can
  // tell "parent changed value out from under us" (real load/reset) apart
  // from "our own buildCron output bounced back." Without this, transient
  // empty cron states (e.g. user deselecting every weekday before adding new
  // ones back) would silently flip the mode to Custom.
  const lastEmittedRef = useRef<string>(buildCron(mode))

  // If the parent resets `value` to something we didn't emit (initial load,
  // edit-view fetch, parent state reset), realign local mode.
  useEffect(() => {
    if (value === lastEmittedRef.current) return
    const incoming = parseCron(value)

    setMode((current) => (sameMode(current, incoming) ? current : incoming))
    lastEmittedRef.current = value
  }, [value])

  const apply = useCallback(
    (next: CronMode) => {
      setMode(next)
      const emitted = buildCron(next)

      lastEmittedRef.current = emitted
      onChange(emitted)
    },
    [onChange],
  )

  const preview = buildCron(mode)
  const timeZone = viewerTimeZone()
  const nextRuns = useMemo(
    () => (preview ? nextOccurrencesAfter(preview, new Date(), 3) : []),
    [preview],
  )

  return (
    <div className="space-y-2.5" role="group" aria-label="Schedule">
      <div className="flex gap-1.5" role="group" aria-label="Schedule mode">
        <ModeTab
          label="Every N hours"
          active={mode.kind === 'every-n-hours'}
          onClick={() =>
            apply(mode.kind === 'every-n-hours' ? mode : { kind: 'every-n-hours', n: 1, minute: 0 })
          }
        />
        <ModeTab
          label="At specific time"
          active={mode.kind === 'at-time'}
          onClick={() =>
            apply(
              mode.kind === 'at-time'
                ? mode
                : { kind: 'at-time', hour: 9, minute: 0, days: [1, 2, 3, 4, 5] },
            )
          }
        />
        <ModeTab
          label="Custom"
          active={mode.kind === 'custom'}
          onClick={() => apply({ kind: 'custom', expr: preview || value })}
        />
      </div>

      {mode.kind === 'every-n-hours' && (
        <div className="flex items-center gap-2 text-[12.5px] text-secondary">
          <span>Every</span>
          <AppSelect
            value={String(mode.n)}
            onValueChange={(nextValue) => apply({ ...mode, n: Number(nextValue) })}
            triggerClassName="h-7 w-[64px] border-zGray-800 px-2 text-[12.5px]"
            options={EVERY_N_HOURS_OPTIONS.map((n) => ({
              value: String(n),
              label: n,
            }))}
          />
          <span>hour{mode.n === 1 ? '' : 's'} at minute</span>
          <input
            type="number"
            min={0}
            max={59}
            value={mode.minute}
            onChange={(e) => {
              const v = Math.max(0, Math.min(59, Number(e.target.value) || 0))

              apply({ ...mode, minute: v })
            }}
            className="w-14 h-7 px-2 rounded-md bg-field border border-zGray-800 text-main text-[12.5px] focus:outline-none focus:border-zViolet-500"
          />
        </div>
      )}

      {mode.kind === 'at-time' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[12.5px] text-secondary">
            <span>At</span>
            <input
              type="number"
              min={0}
              max={23}
              value={pad2(mode.hour)}
              onChange={(e) => {
                const v = Math.max(0, Math.min(23, Number(e.target.value) || 0))

                apply({ ...mode, hour: v })
              }}
              className="w-14 h-7 px-2 rounded-md bg-field border border-zGray-800 text-main text-[12.5px] text-center focus:outline-none focus:border-zViolet-500"
            />
            <span>:</span>
            <input
              type="number"
              min={0}
              max={59}
              value={pad2(mode.minute)}
              onChange={(e) => {
                const v = Math.max(0, Math.min(59, Number(e.target.value) || 0))

                apply({ ...mode, minute: v })
              }}
              className="w-14 h-7 px-2 rounded-md bg-field border border-zGray-800 text-main text-[12.5px] text-center focus:outline-none focus:border-zViolet-500"
            />
            <span className="text-tertiary text-[11.5px]">(24-hour, UTC)</span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {WEEKDAYS.map((d) => {
              const on = mode.days.includes(d.value)

              return (
                <button
                  key={d.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    const next = on
                      ? mode.days.filter((x) => x !== d.value)
                      : [...mode.days, d.value]

                    apply({ ...mode, days: next })
                  }}
                  className={clsx(
                    'h-7 min-w-[40px] px-2 rounded-md border text-[11.5px] transition-colors',
                    on
                      ? 'border-zViolet-500 bg-zViolet-500/15 text-main'
                      : 'border-zGray-800 text-tertiary hover:text-main hover:border-zGray-700',
                  )}
                >
                  {d.short}
                </button>
              )
            })}
            <button
              type="button"
              onClick={() =>
                apply({
                  ...mode,
                  days: mode.days.length === 7 ? [1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6],
                })
              }
              className="ml-1 text-[11px] text-tertiary hover:text-main underline-offset-2 hover:underline"
            >
              {mode.days.length === 7 ? 'Weekdays only' : 'Every day'}
            </button>
          </div>
          {mode.days.length === 0 && (
            <p className="text-[11.5px] text-error">Pick at least one day.</p>
          )}
        </div>
      )}

      {mode.kind === 'custom' && (
        <input
          type="text"
          value={mode.expr}
          onChange={(e) => apply({ kind: 'custom', expr: e.target.value })}
          placeholder="0 9 * * 1-5"
          spellCheck={false}
          className="w-full h-8 px-2.5 rounded-md bg-field border border-zGray-800 font-mono text-[12.5px] text-main focus:outline-none focus:border-zViolet-500"
        />
      )}

      <div className="text-[11px] text-tertiary">
        Cron (UTC):{' '}
        <code className="font-mono text-[11px] text-secondary bg-zGray-900 border border-zGray-800 rounded px-1.5 py-0.5">
          {preview || '—'}
        </code>
      </div>
      {nextRuns.length > 0 && (
        <div className="space-y-0.5 text-[11.5px] text-tertiary">
          <div className="text-secondary">
            {scheduleSummary({ triggerType: 'cron', cronExpression: preview }, timeZone)}
          </div>
          <div>Next runs:</div>
          <ul className="space-y-0.5 pl-2">
            {nextRuns.map((runAt) => (
              <li key={runAt.getTime()}>{formatUtcRun(runAt, timeZone)}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function ModeTab({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={clsx(
        'h-7 px-3 rounded-md text-[12px] border transition-colors',
        active
          ? 'border-zViolet-500 bg-zViolet-500/10 text-main'
          : 'border-zGray-800 text-secondary hover:text-main hover:border-zGray-700',
      )}
    >
      {label}
    </button>
  )
}
