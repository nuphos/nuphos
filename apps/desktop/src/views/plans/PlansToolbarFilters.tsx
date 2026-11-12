import clsx from 'clsx'
import { Ban } from 'lucide-react'

import { t } from '../../i18n'

import type { PlanScope } from './planRows'

// The same pills as the Audit log's Team / Mine filters.
const pill = (active: boolean) =>
  clsx(
    'rounded-full px-2.5 py-1 text-[12px] transition-colors',
    active ? 'bg-surface-sunken text-main' : 'text-tertiary hover:text-secondary',
  )

/** The Plans toolbar's left side: whose plans to list, and the dismissed toggle when it reveals something. */
export function PlansToolbarFilters({
  scope,
  onScopeChange,
  showDismissed,
  onToggleDismissed,
  hasDismissed,
}: {
  scope: PlanScope
  onScopeChange: (scope: PlanScope) => void
  showDismissed: boolean
  onToggleDismissed: () => void
  hasDismissed: boolean
}) {
  return (
    <>
      <div className="flex items-center gap-1" role="group" aria-label={t('Plans')}>
        {(['mine', 'team'] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={scope === value}
            onClick={() => onScopeChange(value)}
            className={pill(scope === value)}
          >
            {value === 'mine' ? t('Mine') : t('Team')}
          </button>
        ))}
      </div>
      {hasDismissed && (
        <button
          type="button"
          onClick={onToggleDismissed}
          className="inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] text-tertiary transition-colors hover:bg-state-hover hover:text-secondary"
        >
          <Ban className="h-3.5 w-3.5" strokeWidth={1.8} />
          {showDismissed ? t('Hide dismissed') : t('Show dismissed')}
        </button>
      )}
    </>
  )
}
