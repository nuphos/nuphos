import clsx from 'clsx'
import { ChevronDown, Copy, Download, Search } from 'lucide-react'

import { api } from '../../api'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../../components/ui/menu'
import { toast } from '../../components/ui/toast'
import { logsToCsv, logsToText } from '../../lib/logView'

import type { TimestampMode } from '../../lib/logView'
import type { WorkloadLogLine } from '../../types'

// Shared log-view toolbar controls: a Find box, a timestamp
// Off/UTC/Local toggle, and an Export menu (download / copy as text / CSV).
// Stateless — the host owns query/timestamp state and supplies the (already
// search-filtered) lines to export via `exportSource`.
export type LogExportSource = { lines: WorkloadLogLine[]; includePod: boolean; fileBase: string }

export function LogViewControls({
  query,
  onQueryChange,
  tsMode,
  onTsModeChange,
  exportSource,
}: {
  query: string
  onQueryChange: (q: string) => void
  tsMode: TimestampMode
  onTsModeChange: (m: TimestampMode) => void
  exportSource: () => LogExportSource
}) {
  async function download(kind: 'text' | 'csv') {
    const { lines, includePod, fileBase } = exportSource()
    const content =
      kind === 'csv'
        ? logsToCsv(lines, { includePod })
        : logsToText(lines, { timestamps: tsMode, includePod })

    try {
      const res = await api.saveTextFile(`${fileBase}.${kind === 'csv' ? 'csv' : 'log'}`, content)

      if (res.saved) toast.success('Logs saved', res.path)
    } catch (e) {
      toast.apiError('Could not save logs', e)
    }
  }
  async function copy(kind: 'text' | 'csv') {
    const { lines, includePod } = exportSource()
    const content =
      kind === 'csv'
        ? logsToCsv(lines, { includePod })
        : logsToText(lines, { timestamps: tsMode, includePod })

    try {
      await navigator.clipboard.writeText(content)
      toast.success(kind === 'csv' ? 'Copied as CSV' : 'Copied as text')
    } catch {
      toast.error('Could not copy logs', 'Clipboard was blocked.')
    }
  }

  return (
    <>
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-tertiary pointer-events-none" />
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Find logs…"
          className="w-44 pl-7 pr-2 py-1 rounded text-[12px] bg-field border border-zGray-800 text-secondary placeholder:text-tertiary focus:outline-none focus:border-zViolet-500/50"
        />
      </div>
      <div className="flex items-center gap-1">
        <span className="text-[11.5px] text-tertiary uppercase tracking-wider mr-0.5">Time</span>
        {(['off', 'utc', 'local'] as TimestampMode[]).map((m) => (
          <button
            key={m}
            onClick={() => onTsModeChange(m)}
            className={clsx(
              'px-2 py-1 rounded text-[12px] capitalize',
              tsMode === m
                ? 'bg-zViolet-500/20 text-zViolet-accent'
                : 'text-secondary hover:bg-zGray-800',
            )}
          >
            {m}
          </button>
        ))}
      </div>
      <Menu>
        <MenuTrigger
          title={query ? 'Exports the current search-filtered view' : 'Exports all loaded logs'}
          className="flex items-center gap-1 px-2 py-1 rounded text-[12px] text-secondary hover:bg-zGray-800"
        >
          <Download className="w-3 h-3" />
          Export
          <ChevronDown className="w-3 h-3" />
        </MenuTrigger>
        <MenuContent align="end">
          <MenuItem
            icon={<Download className="w-3.5 h-3.5" />}
            onClick={() => void download('text')}
          >
            Download as Text
          </MenuItem>
          <MenuItem
            icon={<Download className="w-3.5 h-3.5" />}
            onClick={() => void download('csv')}
          >
            Download as CSV
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={<Copy className="w-3.5 h-3.5" />} onClick={() => void copy('text')}>
            Copy as Text
          </MenuItem>
          <MenuItem icon={<Copy className="w-3.5 h-3.5" />} onClick={() => void copy('csv')}>
            Copy as CSV
          </MenuItem>
        </MenuContent>
      </Menu>
    </>
  )
}

export type LogRangeMode = 'lines' | 'time'

// Time-window options for "Time" range mode. `seconds: null` = All (no
// sinceSeconds limit); the line-count cap still bounds each fetch.
const LOG_TIME_OPTIONS: { label: string; seconds: number | null }[] = [
  { label: '5m', seconds: 5 * 60 },
  { label: '30m', seconds: 30 * 60 },
  { label: '1h', seconds: 60 * 60 },
  { label: '6h', seconds: 6 * 60 * 60 },
  { label: '24h', seconds: 24 * 60 * 60 },
  { label: 'All (5k)', seconds: null },
]
const LOG_LINE_OPTIONS = [100, 200, 500, 1000]

// Upper bound on lines fetched in Time mode so "All" / a wide window can't pull
// an unbounded log on a high-throughput service.
export const LOG_TIME_MODE_CAP = 5000

function rangeBtn(active: boolean): string {
  return clsx(
    'px-2 py-1 rounded text-[12px]',
    active ? 'bg-zViolet-500/20 text-zViolet-accent' : 'text-secondary hover:bg-zGray-800',
  )
}

// Range selector shared by the Pod and Workload log toolbars: a Lines|Time mode
// switch, then the options for the active mode (line counts or time windows).
// Raw buttons match the rest of the toolbar; type=button + aria-pressed for a11y.
export function LogRangeSelector({
  mode,
  onModeChange,
  tailLines,
  onTailLinesChange,
  sinceSeconds,
  onSinceSecondsChange,
}: {
  mode: LogRangeMode
  onModeChange: (m: LogRangeMode) => void
  tailLines: number
  onTailLinesChange: (n: number) => void
  sinceSeconds: number | null
  onSinceSecondsChange: (s: number | null) => void
}) {
  return (
    <>
      <span className="text-[11.5px] text-tertiary uppercase tracking-wider">Range</span>
      <div className="inline-flex rounded overflow-hidden border border-zGray-800">
        {(['lines', 'time'] as LogRangeMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onModeChange(m)}
            aria-pressed={mode === m}
            className={clsx(
              'px-2 py-1 text-[12px] capitalize',
              mode === m
                ? 'bg-zViolet-500/20 text-zViolet-accent'
                : 'text-secondary hover:bg-zGray-800',
            )}
          >
            {m}
          </button>
        ))}
      </div>
      {mode === 'lines'
        ? LOG_LINE_OPTIONS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onTailLinesChange(n)}
              aria-pressed={tailLines === n}
              className={rangeBtn(tailLines === n)}
            >
              {n}
            </button>
          ))
        : LOG_TIME_OPTIONS.map((t) => (
            <button
              key={t.label}
              type="button"
              onClick={() => onSinceSecondsChange(t.seconds)}
              aria-pressed={sinceSeconds === t.seconds}
              className={rangeBtn(sinceSeconds === t.seconds)}
            >
              {t.label}
            </button>
          ))}
    </>
  )
}

// Previous (terminated) instance toggle, shared by both log toolbars. Disabled
// in Time mode — a previous instance is historical, so a relative time window
// doesn't apply.
export function LogPreviousToggle({
  value,
  onChange,
  disabled,
}: {
  value: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      disabled={disabled}
      aria-pressed={value}
      title={
        disabled
          ? 'Previous-instance logs are only available in Lines mode'
          : "Show the previous (terminated) instance's logs — for post-crash / CrashLoopBackOff triage"
      }
      className={clsx(
        'px-2 py-1 rounded text-[12px]',
        value ? 'bg-zViolet-500/20 text-zViolet-accent' : 'text-secondary hover:bg-zGray-800',
        disabled && 'opacity-40 cursor-not-allowed',
      )}
    >
      Previous
    </button>
  )
}
