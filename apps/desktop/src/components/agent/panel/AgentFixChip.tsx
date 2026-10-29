import clsx from 'clsx'
import { Loader2 } from 'lucide-react'

import { t } from '../../../i18n'

import { agentFixLabel } from './agentRowFix'

import type { AgentFix } from './agentRowFix'
import type { PickerFixes } from './usePickerFixes'

const CHIP =
  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded border px-1.5 py-px text-[10.5px] font-medium normal-case leading-4 tracking-normal'

/** The fix as a button chip in a picker row. */
export function AgentFixChip({ fix, fixes }: { fix: AgentFix; fixes: PickerFixes }) {
  const label = agentFixLabel(fix)

  // Who to ask is said in the row's subtitle, where a long name can truncate.
  if (fix.kind === 'ask' || !label) return null
  if (fixes.busy(fix))
    return (
      <span className={clsx(CHIP, 'border-warning/30 bg-warning/10 text-warning')} role="status">
        <Loader2 aria-hidden className="h-2.5 w-2.5 animate-spin motion-reduce:animate-none" />
        {fix.kind === 'resume' ? t('Resuming…') : t('Checking…')}
      </span>
    )

  return (
    <button
      type="button"
      className={clsx(
        CHIP,
        'cursor-pointer border-warning/40 bg-warning/10 text-warning transition-colors hover:bg-warning/20',
      )}
      // Inside a menu item: the fix neither picks this agent nor lets the item act on its own.
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        fixes.run(fix)
      }}
    >
      {label}
    </button>
  )
}
