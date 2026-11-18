import { t } from '../../i18n'

import { formatChange, formatTokens, formatUsd, usageGroupLabel } from './tokenUsagePresentation'

import type { TokenUsageLine } from './tokenUsagePresentation'
import type { UsageDimension } from '../../types/usage'

const COLUMNS = 'grid-cols-[minmax(0,1fr)_repeat(6,minmax(4.5rem,auto))]'
const amount = 'text-right font-mono'

const heading = (label: string) => (
  <span role="columnheader" className="text-right">
    {label}
  </span>
)

/** One line per group, its share of the range and its change since the period before; a
 *  group's name opens it, when `onOpen` is given. */
export function UsageTable({
  lines,
  total,
  group,
  onOpen,
}: {
  lines: TokenUsageLine[]
  total: number
  group: UsageDimension
  onOpen?: (line: TokenUsageLine) => void
}) {
  return (
    <div role="table" aria-label={t('Token usage by group')} className="mt-3 text-xs">
      <div
        role="row"
        className={`grid ${COLUMNS} gap-3 border-b border-line-control/60 pb-2 text-tertiary`}
      >
        <span role="columnheader">{usageGroupLabel(group)}</span>
        {heading(t('Total'))}
        {heading(t('Share'))}
        {heading(t('vs previous'))}
        {heading(t('Input'))}
        {heading(t('Output'))}
        {heading(t('Est. cost'))}
      </div>
      {lines.map((line) => (
        <div
          key={line.key}
          role="row"
          className={`grid ${COLUMNS} gap-3 border-b border-line-control/30 py-2 text-main`}
        >
          <span role="cell" className="min-w-0 truncate" title={line.label}>
            {onOpen && line.key ? (
              <button
                type="button"
                onClick={() => onOpen(line)}
                className="max-w-full truncate text-left underline-offset-2 hover:underline"
              >
                {line.label}
              </button>
            ) : (
              line.label
            )}
          </span>
          <span role="cell" className={amount}>
            {formatTokens(line.totalTokens)}
          </span>
          <span role="cell" className={amount}>
            {total > 0 ? `${String(Math.round((line.totalTokens / total) * 100))}%` : '—'}
          </span>
          <span role="cell" className={amount}>
            {formatChange(line)}
          </span>
          <span role="cell" className={amount}>
            {formatTokens(line.inputTokens)}
          </span>
          <span role="cell" className={amount}>
            {formatTokens(line.outputTokens)}
          </span>
          <span role="cell" className={amount}>
            {line.costUsd === undefined ? '—' : formatUsd(line.costUsd)}
          </span>
        </div>
      ))}
    </div>
  )
}
