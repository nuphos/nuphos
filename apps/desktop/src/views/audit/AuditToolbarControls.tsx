import clsx from 'clsx'
import { Download, Loader2, Zap } from 'lucide-react'

import { Button } from '../../components/ui/button'

import { RANGE_LABEL } from './shared'

import type { Range, Scope, Tab } from './shared'

const pill = (active: boolean) =>
  clsx(
    'rounded-full px-2.5 py-1 text-[12px] transition-colors',
    active ? 'bg-zGray-800 text-main' : 'text-tertiary hover:text-secondary',
  )

export function AuditFilterControls({
  tab,
  setTab,
  scope,
  setScope,
  mutationsOnly,
  setMutationsOnly,
  range,
  setRange,
  setSelectedSessionIds,
}: {
  tab: Tab
  setTab: (tab: Tab) => void
  scope: Scope
  setScope: (scope: Scope) => void
  mutationsOnly: boolean
  setMutationsOnly: (update: (v: boolean) => boolean) => void
  range: Range
  setRange: (range: Range) => void
  setSelectedSessionIds: (ids: Set<string>) => void
}) {
  return (
    <>
      <div className="flex items-center gap-1">
        {(['conversations', 'events'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              setTab(t)
              if (t !== 'conversations') setSelectedSessionIds(new Set())
            }}
            className={pill(tab === t)}
          >
            {t === 'conversations' ? 'Conversations' : 'All events'}
          </button>
        ))}
      </div>
      <div className="mx-1 h-4 w-px bg-zGray-800" />
      <div className="flex items-center gap-1">
        {(['team', 'mine'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setScope(s)
              setSelectedSessionIds(new Set())
            }}
            className={pill(scope === s)}
          >
            {s === 'team' ? 'Team' : 'Mine'}
          </button>
        ))}
      </div>
      <div className="mx-1 h-4 w-px bg-zGray-800" />
      <button
        type="button"
        onClick={() => {
          setMutationsOnly((v) => !v)
          setSelectedSessionIds(new Set())
        }}
        className={clsx(
          'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] transition-colors',
          mutationsOnly ? 'bg-amber-500/15 text-amber-300' : 'text-tertiary hover:text-secondary',
        )}
        title="Only mutations (skill changes, bash, outbound messages)"
      >
        <Zap className="h-3 w-3" strokeWidth={2} />
        Mutations only
      </button>
      <div className="mx-1 h-4 w-px bg-zGray-800" />
      <select
        value={range}
        onChange={(e) => {
          setRange(e.target.value as Range)
          setSelectedSessionIds(new Set())
        }}
        className="h-7 rounded-md bg-transparent px-2 text-[12px] text-secondary outline-none transition-colors hover:bg-zGray-800/60"
      >
        {(Object.keys(RANGE_LABEL) as Range[]).map((value) => (
          <option key={value} value={value} className="bg-zGray-900">
            {RANGE_LABEL[value]}
          </option>
        ))}
      </select>
    </>
  )
}

export function AuditExportButton({
  exporting,
  onExport,
}: {
  exporting: boolean
  onExport: () => void
}) {
  return (
    <Button
      variant="primary"
      size="sm"
      disabled={exporting}
      onClick={onExport}
      className="h-7 flex-shrink-0 gap-1.5 px-2.5 text-[12px]"
      title="Export a verifiable compliance evidence package for everything matching the current filters"
    >
      {exporting ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
      ) : (
        <Download className="h-3.5 w-3.5" strokeWidth={2} />
      )}
      {exporting ? 'Exporting…' : 'Export all'}
    </Button>
  )
}
